const MODEL_SHORT_NAMES: Record<string, string> = {
  'claude-opus-4-20250514': 'Opus 4',
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-haiku-3-5-20241022': 'Haiku 3.5',
  'claude-opus-3-20250214': 'Opus 3',
  'claude-sonnet-3-20250214': 'Sonnet 3',
  'claude-sonnet-3-5-20250214': 'Sonnet 3.5',
  'claude-haiku-3-20250214': 'Haiku 3',
  'claude-opus-4': 'Opus 4',
  'claude-sonnet-4': 'Sonnet 4',
  'claude-haiku-4': 'Haiku 4',
};

export function shortModelName(modelId: string): string {
  modelId = modelId.trim().toLowerCase().split('/').pop()!;
  if (MODEL_SHORT_NAMES[modelId]) {
    return MODEL_SHORT_NAMES[modelId];
  }

  const match = modelId.match(/^claude-(opus|sonnet|haiku)-?[\d.]*-?/);
  if (match) {
    const modelType = match[1];
    const versionMatch = modelId.replace(/-\d{8}$/, '').match(/(\d+(?:[.-]\d+)?)/);
    if (versionMatch) {
      return `${modelType.charAt(0).toUpperCase() + modelType.slice(1)} ${versionMatch[1].replace('-', '.')}`;
    }
    return modelType.charAt(0).toUpperCase() + modelType.slice(1);
  }

  return modelId;
}
