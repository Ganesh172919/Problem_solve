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

  // Sanitize potentially unsafe tags
  formatted = formatted.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  formatted = formatted.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  formatted = formatted.replace(/on\w+="[^"]*"/gi, '');
  formatted = formatted.replace(/on\w+='[^']*'/gi, '');
  formatted = formatted.replace(/javascript:/gi, '');

  // Ensure proper paragraph wrapping for loose text lines
  const lines = formatted.split('\n');
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<')) return trimmed;
    return `<p>${trimmed}</p>`;
  });

  formatted = processedLines.filter(Boolean).join('\n');

  return formatted;
}
