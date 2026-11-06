/**
 * Gemini TTS prebuilt voices. The API has no "list voices" endpoint, so this catalogue is maintained from
 * Google's documentation; `presentation` (male/female-sounding) is Google's own characterisation and is approximate.
 * The authoritative check is a live preview: an unsupported voice name is rejected by the API.
 */
const V = (name, style, presentation) => ({ name, style, presentation });
export const VOICES = [
  V('Zephyr', 'Bright', 'female'), V('Puck', 'Upbeat', 'male'), V('Charon', 'Informative', 'male'),
  V('Kore', 'Firm', 'female'), V('Fenrir', 'Excitable', 'male'), V('Leda', 'Youthful', 'female'),
  V('Orus', 'Firm', 'male'), V('Aoede', 'Breezy', 'female'), V('Callirrhoe', 'Easy-going', 'female'),
  V('Autonoe', 'Bright', 'female'), V('Enceladus', 'Breathy', 'male'), V('Iapetus', 'Clear', 'male'),
  V('Umbriel', 'Easy-going', 'male'), V('Algieba', 'Smooth', 'male'), V('Despina', 'Smooth', 'female'),
  V('Erinome', 'Clear', 'female'), V('Algenib', 'Gravelly', 'male'), V('Rasalgethi', 'Informative', 'male'),
  V('Laomedeia', 'Upbeat', 'female'), V('Achernar', 'Soft', 'female'), V('Alnilam', 'Firm', 'male'),
  V('Schedar', 'Even', 'male'), V('Gacrux', 'Mature', 'female'), V('Pulcherrima', 'Forward', 'female'),
  V('Achird', 'Friendly', 'male'), V('Zubenelgenubi', 'Casual', 'male'), V('Vindemiatrix', 'Gentle', 'female'),
  V('Sadachbia', 'Lively', 'male'), V('Sadaltager', 'Knowledgeable', 'male'), V('Sulafat', 'Warm', 'female'),
];

export const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' }, { code: 'en-IN', label: 'English (India)' }, { code: 'en-GB', label: 'English (UK)' },
  { code: 'hi-IN', label: 'Hindi (Devanagari script)' },
  { code: 'hinglish', label: 'Hinglish (Hindi in Roman script)', hint: 'Speak natural conversational Hinglish: Hindi written in Roman letters with common English words, Indian accent.' },
  { code: 'bn-BD', label: 'Bengali' }, { code: 'ta-IN', label: 'Tamil' }, { code: 'te-IN', label: 'Telugu' },
  { code: 'mr-IN', label: 'Marathi' }, { code: 'gu-IN', label: 'Gujarati' }, { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' }, { code: 'pa-IN', label: 'Punjabi' }, { code: 'ur-PK', label: 'Urdu' },
  { code: 'es-US', label: 'Spanish' }, { code: 'fr-FR', label: 'French' }, { code: 'de-DE', label: 'German' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' }, { code: 'it-IT', label: 'Italian' }, { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' }, { code: 'ar-EG', label: 'Arabic' }, { code: 'id-ID', label: 'Indonesian' },
  { code: 'ru-RU', label: 'Russian' }, { code: 'tr-TR', label: 'Turkish' }, { code: 'vi-VN', label: 'Vietnamese' }, { code: 'th-TH', label: 'Thai' },
];

export const TONES = {
  neutral: 'in a clear, natural tone',
  warm: 'in a warm, friendly tone',
  energetic: 'in an energetic, upbeat tone',
  excited: 'with genuine excitement',
  calm: 'in a calm, soothing tone',
  serious: 'in a serious, authoritative tone',
  storytelling: 'like a captivating storyteller',
  professional: 'in a polished, professional presenter tone',
};
