export interface SplitLyricText {
  original: string
  translation: string
}

export function splitLyricTranslation(text: string): SplitLyricText {
  const hanIndex = text.search(/\p{Script=Han}/u)
  if (hanIndex <= 0) {
    return { original: text, translation: '' }
  }

  const original = text.slice(0, hanIndex).trim()
  const translation = text.slice(hanIndex).trim()
  if (!original || !/[A-Za-z]/.test(original)) {
    return { original: text, translation: '' }
  }

  return { original, translation }
}
