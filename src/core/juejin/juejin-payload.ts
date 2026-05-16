interface BuildJuejinDraftPayloadInput {
  title: string;
  markdown: string;
  categoryId: string;
}

export function replaceLocalImageUrls(markdown: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce((current, [from, to]) => {
    const escapedSource = escapeRegExp(from);
    const obsidianPattern = new RegExp(`!\\[\\[\\s*${escapedSource}(?:\\|[^\\]]*)?\\s*\\]\\]`, 'g');
    const markdownImagePattern = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedSource}(\\))`, 'g');

    const withObsidianImagesRewritten = current.replace(obsidianPattern, `![](${to})`);
    return withObsidianImagesRewritten.replace(markdownImagePattern, `$1${to}$2`);
  }, markdown);
}

export function buildJuejinDraftPayload(input: BuildJuejinDraftPayloadInput) {
  return {
    category_id: input.categoryId,
    tag_ids: [],
    link_url: '',
    cover_image: '',
    is_gfw: 0,
    title: input.title,
    brief_content: '',
    is_english: 0,
    is_original: 1,
    edit_type: 10,
    html_content: '',
    mark_content: input.markdown,
    theme_ids: [],
    pics: []
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
