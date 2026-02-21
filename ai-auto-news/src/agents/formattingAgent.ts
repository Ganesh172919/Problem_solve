import DOMPurify from 'isomorphic-dompurify';

export function formattingAgent(content: string): string {
  let formatted = content;

  // Remove markdown artifacts
  formatted = formatted.replace(/```html?\n?/g, '');
  formatted = formatted.replace(/```\n?/g, '');
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  formatted = formatted.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  formatted = formatted.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  formatted = formatted.replace(/^- (.*?)$/gm, '<li>$1</li>');
  formatted = formatted.replace(/^(\d+)\. (.*?)$/gm, '<li>$2</li>');

  // Wrap consecutive <li> elements in <ul>
  formatted = formatted.replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ensure proper paragraph wrapping for loose text lines
  const lines = formatted.split('\n');
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<')) return trimmed;
    return `<p>${trimmed}</p>`;
  });

  formatted = processedLines.filter(Boolean).join('\n');

  // Sanitize with DOMPurify to remove XSS vectors
  formatted = DOMPurify.sanitize(formatted, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br', 'blockquote', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });

  return formatted;
}
