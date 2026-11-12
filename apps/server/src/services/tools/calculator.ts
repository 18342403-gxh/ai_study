/**
 * 安全计算器：递归下降解析四则运算，不使用 eval / Function。
 * 支持：+、-、*、/、%（取余）、括号、小数与科学计数法。
 */

class ExpressionParser {
  private pos = 0

  constructor(private readonly input: string) {}

  parse(): number {
    this.skipSpace()
    const value = this.parseExpression()
    this.skipSpace()
    if (this.pos !== this.input.length) {
      throw new Error(`无法识别位置 ${this.pos + 1} 附近的字符`)
    }
    return value
  }

  private skipSpace(): void {
    while (/\s/.test(this.input[this.pos] ?? '')) this.pos++
  }

  private parseExpression(): number {
    let value = this.parseTerm()
    while (true) {
      this.skipSpace()
      const operator = this.input[this.pos]
      if (operator !== '+' && operator !== '-') return value
      this.pos++
      const right = this.parseTerm()
      value = operator === '+' ? value + right : value - right
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary()
    while (true) {
      this.skipSpace()
      const operator = this.input[this.pos]
      if (operator !== '*' && operator !== '/' && operator !== '%') return value
      this.pos++
      const right = this.parseUnary()
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new Error(operator === '/' ? '除数不能为 0' : '取余的除数不能为 0')
      }
      if (operator === '*') value *= right
      else if (operator === '/') value /= right
      else value %= right
    }
  }

  private parseUnary(): number {
    this.skipSpace()
    const operator = this.input[this.pos]
    if (operator === '+' || operator === '-') {
      this.pos++
      const value = this.parseUnary()
      return operator === '-' ? -value : value
    }
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    this.skipSpace()
    if (this.input[this.pos] === '(') {
      this.pos++
      const value = this.parseExpression()
      this.skipSpace()
      if (this.input[this.pos] !== ')') throw new Error('缺少右括号')
      this.pos++
      return value
    }

    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.input.slice(this.pos))
    if (!match) throw new Error(`位置 ${this.pos + 1} 处应为数字或括号`)
    this.pos += match[0].length
    return Number(match[0])
  }
}

export const calculate = (expression: string): number => {
  const normalized = expression
    .trim()
    .replaceAll('×', '*')
    .replaceAll('÷', '/')
    .replaceAll('（', '(')
    .replaceAll('）', ')')
  if (!normalized) throw new Error('算式不能为空')
  if (normalized.length > 200) throw new Error('算式过长（最多 200 字符）')

  const result = new ExpressionParser(normalized).parse()
  if (!Number.isFinite(result)) throw new Error('计算结果不是有限数字')
  // 消除 0.1 + 0.2 这类二进制浮点尾差，保留 12 位有效数字。
  return Number(result.toPrecision(12))
}
