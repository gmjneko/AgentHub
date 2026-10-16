export interface MentionLabel {
  id: string
  label: string
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ids whose @label appears in text, followed by a space. */
export function extractMentionIds(value: string, targets: MentionLabel[]): string[] {
  const ids = new Set<string>()
  for (const target of targets) {
    const label = target.label.trim()
    if (!target.id || !label) continue
    const pattern = new RegExp(
      `(^|[\\s([{（，。！？、；：,.!?;:])@${escapeRegExp(label)}(?= )`,
      'u'
    )
    if (pattern.test(value)) ids.add(target.id)
  }
  return [...ids]
}
