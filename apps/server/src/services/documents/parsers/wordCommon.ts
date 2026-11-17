/**
 * Word 解析的底层能力
 *
 * mammoth：解析 OOXML（.docx），保留段落与表格文本，输出质量最好。
 * word-extractor：纯 JS 解析 OLE2（.doc），无外部二进制依赖。
 *
 * 两个解析器互为兜底：现实中「.doc 改名成 .docx」「.docx 另存为 .doc」
 * 都很常见，只看扩展名会直接失败。
 */

export const extractWithMammoth = async (
  buffer: Buffer,
): Promise<{ text: string; warnings: string[] }> => {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  const warnings = (result.messages ?? [])
    .filter((item) => item.type === 'warning')
    .map((item) => item.message)
  return { text: result.value, warnings }
}

export const extractWithWordExtractor = async (buffer: Buffer): Promise<string> => {
  const WordExtractor = (await import('word-extractor')).default
  const doc = await new WordExtractor().extract(buffer)
  const body = doc.getBody()
  const footnotes = doc.getFootnotes()
  // 脚注常包含补充说明，拼在正文后避免信息丢失
  return footnotes && footnotes.trim() ? `${body}\n\n${footnotes}` : body
}
