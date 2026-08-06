let audioContext = null;
let masterGain = null;
let alarmBuffer = null;
let alarmSource = null;
let alarmActive = false;

const AudioContextClass = () => window.AudioContext || window.webkitAudioContext;

function ensureAudioContext() {
    if (audioContext) return audioContext;
    const Context = AudioContextClass();
    if (!Context) return null;
    audioContext = new Context();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioContext.destination);
    return audioContext;
}

function createAlarmBuffer(context) {
    const durationSeconds = 1;
    const frameCount = Math.floor(context.sampleRate * durationSeconds);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    const toneDuration = 0.24;

    for (let index = 0; index < frameCount; index += 1) {
        const time = index / context.sampleRate;
        const isHighTone = time < toneDuration;
        const isLowTone = time >= 0.5 && time < 0.5 + toneDuration;
        if (!isHighTone && !isLowTone) continue;

        const localTime = isHighTone ? time : time - 0.5;
        const frequency = isHighTone ? 1040 : 760;
        const attack = Math.min(1, localTime / 0.015);
        const release = Math.min(1, (toneDuration - localTime) / 0.04);
        const envelope = Math.max(0, Math.min(attack, release));
        samples[index] = Math.sin(2 * Math.PI * frequency * localTime) * envelope * 0.22;
    }
    return buffer;
}

function startAlarmLoop() {
    const context = ensureAudioContext();
    if (!context || !masterGain || !alarmActive || alarmSource || context.state !== 'running') return;
    if (!alarmBuffer) alarmBuffer = createAlarmBuffer(context);
    alarmSource = context.createBufferSource();
    alarmSource.buffer = alarmBuffer;
    alarmSource.loop = true;
    alarmSource.connect(masterGain);
    alarmSource.start();
}

export async function primeLeakAlarmAudio() {
    const context = ensureAudioContext();
    if (!context) return false;
    try {
        if (context.state !== 'running') await context.resume();
        if (alarmActive) startAlarmLoop();
        return context.state === 'running';
    } catch (error) {
        console.warn('浏览器阻止了漏水警报音频激活:', error);
        return false;
    }
}

export function startLeakAlarmAudio() {
    if (alarmActive) return;
    alarmActive = true;
    void primeLeakAlarmAudio();
}

export function stopLeakAlarmAudio() {
    alarmActive = false;
    if (alarmSource) {
        try {
            alarmSource.stop();
            alarmSource.disconnect();
        } catch (error) {
            console.warn('停止漏水警报声音失败:', error);
        }
        alarmSource = null;
    }
}

export async function disposeLeakAlarmAudio() {
    stopLeakAlarmAudio();
    if (audioContext) {
        try {
            await audioContext.close();
        } catch (error) {
            console.warn('关闭漏水警报音频失败:', error);
        }
    }
    audioContext = null;
    masterGain = null;
    alarmBuffer = null;
}
