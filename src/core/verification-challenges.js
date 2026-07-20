const ENGLISH_SMALL_NUMBERS = {
    eight: 8,
    eighteen: 18,
    eleven: 11,
    fifteen: 15,
    five: 5,
    four: 4,
    fourteen: 14,
    nine: 9,
    nineteen: 19,
    one: 1,
    seven: 7,
    seventeen: 17,
    six: 6,
    sixteen: 16,
    ten: 10,
    thirteen: 13,
    three: 3,
    twelve: 12,
    two: 2,
    zero: 0,
};

const ENGLISH_TENS = {
    eighty: 80,
    fifty: 50,
    forty: 40,
    ninety: 90,
    seventy: 70,
    sixty: 60,
    thirty: 30,
    twenty: 20,
};

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseEnglishNumber(value) {
    const tokens = normalizeText(value)
        .toLowerCase()
        .replace(/-/g, ' ')
        .split(/\s+/)
        .filter(token => token && token !== 'and');

    function parseUnderOneHundred(parts) {
        if (parts.length === 1) {
            return ENGLISH_SMALL_NUMBERS[parts[0]] ?? ENGLISH_TENS[parts[0]];
        }

        if (
            parts.length === 2 &&
            ENGLISH_TENS[parts[0]] != null &&
            ENGLISH_SMALL_NUMBERS[parts[1]] > 0 &&
            ENGLISH_SMALL_NUMBERS[parts[1]] < 10
        ) {
            return ENGLISH_TENS[parts[0]] + ENGLISH_SMALL_NUMBERS[parts[1]];
        }

        return undefined;
    }

    const hundredIndex = tokens.indexOf('hundred');

    if (hundredIndex === -1) {
        return parseUnderOneHundred(tokens);
    }

    if (
        hundredIndex !== 1 ||
        ENGLISH_SMALL_NUMBERS[tokens[0]] == null ||
        ENGLISH_SMALL_NUMBERS[tokens[0]] < 1 ||
        ENGLISH_SMALL_NUMBERS[tokens[0]] > 9
    ) {
        return undefined;
    }

    const remainder = tokens.slice(2);
    const remainderValue = remainder.length === 0
        ? 0
        : parseUnderOneHundred(remainder);

    return remainderValue == null
        ? undefined
        : ENGLISH_SMALL_NUMBERS[tokens[0]] * 100 + remainderValue;
}

function parseQuestionNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) ? number : parseEnglishNumber(value);
}

export function normalizeCaptchaChallenge(value) {
    const challenge = value?.result ?? value;
    const token = String(challenge?.token ?? '').trim();
    const bgSvg = String(challenge?.bgSvg ?? '').trim();
    const bgImage = String(challenge?.bgImage ?? '').trim();
    const pieceSvg = String(challenge?.pieceSvg ?? '').trim();

    if (!token || (!bgSvg && !(bgImage && pieceSvg))) {
        return null;
    }

    return {
        token,
        ...(bgSvg ? { bgSvg } : { bgImage, pieceSvg }),
    };
}

export function normalizeStaffQuestion(value) {
    const pending = value?.pending ?? value;
    const id = pending?.id;
    const question = normalizeText(pending?.question);
    const castCount = Number(pending?.castCount);

    if (id == null || !question) {
        return null;
    }

    return {
        id,
        question,
        ...(Number.isFinite(castCount) && castCount >= 0 ? { castCount } : {}),
    };
}

export function solveStaffQuestion(question) {
    const normalizedQuestion = normalizeText(question);
    const match =
        normalizedQuestion.match(
            /^(?:how much is|what is|calculate)\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(x|×|\*|\+|-|−|÷|\/|plus|minus|times|multiplied by|divided by)\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\??$/i,
        ) ??
        normalizedQuestion.match(
            /^(?:how much is|what is|calculate)\s+(.+?)\s+(plus|minus|times|multiplied by|divided by)\s+(.+?)\s*\??$/i,
        ) ??
        normalizedQuestion.match(
            /^(?:请?计算\s*)?([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(x|×|\*|\+|-|−|÷|\/|加|减|乘|乘以|除以)\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:等于多少|是多少|结果是多少)?\s*[?？]?$/i,
        );

    if (!match) {
        return null;
    }

    const left = parseQuestionNumber(match[1]);
    const right = parseQuestionNumber(match[3]);
    const operator = match[2].toLowerCase();
    let result;

    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return null;
    }

    if (
        ['x', '×', '*', 'times', 'multiplied by', '乘', '乘以'].includes(
            operator,
        )
    ) {
        result = left * right;
    } else if (['+', 'plus', '加'].includes(operator)) {
        result = left + right;
    } else if (['-', '−', 'minus', '减'].includes(operator)) {
        result = left - right;
    } else if (
        ['/', '÷', 'divided by', '除以'].includes(operator) &&
        right !== 0
    ) {
        result = left / right;
    } else {
        return null;
    }

    if (!Number.isFinite(result)) {
        return null;
    }

    const normalizedResult = Math.round(result * 1e10) / 1e10;

    return String(Object.is(normalizedResult, -0) ? 0 : normalizedResult);
}

export function findCaptchaGapFromPixels(imageData, pieceDimensions) {
    const canvasWidth = Number(imageData?.width);
    const canvasHeight = Number(imageData?.height);
    const pixels = imageData?.data;
    const gapWidth = Math.round(Number(pieceDimensions?.width));
    const gapHeight = Math.round(Number(pieceDimensions?.height));

    if (
        !Number.isInteger(canvasWidth) ||
        !Number.isInteger(canvasHeight) ||
        canvasWidth <= 0 ||
        canvasHeight <= 0 ||
        pixels?.length !== canvasWidth * canvasHeight * 4
    ) {
        throw new Error('验证码背景像素数据无效。');
    }

    if (
        !Number.isInteger(gapWidth) ||
        !Number.isInteger(gapHeight) ||
        gapWidth <= 2 ||
        gapHeight <= 2 ||
        gapWidth >= canvasWidth ||
        gapHeight > canvasHeight
    ) {
        throw new Error('验证码拼图尺寸无效。');
    }

    const gapTop = Math.round((canvasHeight - gapHeight) / 2);
    const sampleTop = Math.max(0, gapTop + 1);
    const sampleBottom = Math.min(canvasHeight, gapTop + gapHeight - 1);
    const sampleHeight = sampleBottom - sampleTop;
    const colorCounts = new Map();

    for (let y = sampleTop; y < sampleBottom; y += 1) {
        for (let x = 0; x < canvasWidth; x += 1) {
            const offset = (y * canvasWidth + x) * 4;
            const color =
                pixels[offset] * 0x1000000 +
                pixels[offset + 1] * 0x10000 +
                pixels[offset + 2] * 0x100 +
                pixels[offset + 3];

            colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
        }
    }

    let repeatedColor = null;
    let repeatedColorCount = 0;

    for (const [color, count] of colorCounts) {
        if (count > repeatedColorCount) {
            repeatedColor = color;
            repeatedColorCount = count;
        }
    }

    const columnMatches = new Uint16Array(canvasWidth);

    for (let x = 0; x < canvasWidth; x += 1) {
        for (let y = sampleTop; y < sampleBottom; y += 1) {
            const offset = (y * canvasWidth + x) * 4;
            const color =
                pixels[offset] * 0x1000000 +
                pixels[offset + 1] * 0x10000 +
                pixels[offset + 2] * 0x100 +
                pixels[offset + 3];

            if (color === repeatedColor) {
                columnMatches[x] += 1;
            }
        }
    }

    const minimumColumnMatches = Math.floor(sampleHeight * 0.8);
    const minimumRunWidth = Math.floor(gapWidth * 0.6);
    const maximumRunWidth = Math.ceil(gapWidth * 1.2);
    const candidates = [];
    let runStart = null;

    for (let x = 0; x <= canvasWidth; x += 1) {
        const isMatchingColumn = x < canvasWidth &&
            columnMatches[x] >= minimumColumnMatches;

        if (isMatchingColumn && runStart == null) {
            runStart = x;
        } else if (!isMatchingColumn && runStart != null) {
            const runWidth = x - runStart;

            if (runWidth >= minimumRunWidth && runWidth <= maximumRunWidth) {
                candidates.push({
                    end: x,
                    start: runStart,
                    width: runWidth,
                });
            }

            runStart = null;
        }
    }

    const gap = candidates.sort(
        (left, right) =>
            Math.abs(left.width - gapWidth) -
                Math.abs(right.width - gapWidth),
    )[0];

    if (!gap) {
        throw new Error('未找到验证码图片中的缺口。');
    }

    const gapX = Math.round((gap.start + gap.end - gapWidth) / 2);
    const travelWidth = canvasWidth - gapWidth;

    if (gapX < 0 || gapX > travelWidth) {
        throw new Error('验证码缺口坐标超出可移动范围。');
    }

    return {
        canvasWidth,
        gapX,
        gapWidth,
        ratio: gapX / travelWidth,
    };
}
