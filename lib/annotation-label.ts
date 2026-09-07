/** Display labels are stable within a chapter; URL annotation IDs stay unchanged. */
export function annotationLabel(sceneId: string, index: number) {
  return `${Number(sceneId)}${String.fromCharCode(97 + index)}`;
}
