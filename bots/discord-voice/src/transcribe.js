import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

let openai = null;
let useOpenAI = false;

export async function ensureTranscribe() {
  const mode = (process.env.WHISPER_API || '').toLowerCase();
  if (mode === 'openai' && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    useOpenAI = true;
    console.log('Transcription: OpenAI API mode enabled');
  } else {
    useOpenAI = false;
    console.log('Transcription: local stub mode (no real ASR)');
  }
}

export async function transcribeBuffer(audioBuffer) {
  if (useOpenAI) {
    // Prefer the faster transcribe model if available, fallback to whisper-1
    const model = process.env.WHISPER_MODEL || 'gpt-4o-mini-transcribe';
    // audioBuffer expected to be a WAV buffer (16k mono)
    const file = await toFile(new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    const resp = await openai.audio.transcriptions.create({ file, model });
    return { text: resp.text || '' };
  }
  // Stub: return duration hint only (assumes 16k mono WAV; rough estimate by bytes/2/16000)
  const durationSeconds = (audioBuffer.length / 2 / 16000).toFixed(2);
  return { text: `(captured ${durationSeconds}s of audio)` };
}
