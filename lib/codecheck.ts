/**
 * 引导式代码实训: 参考代码解析与逐行比对验证
 *
 * 约定(教师编写参考代码时):
 *  - 空行与整行注释不要求学生输入, 作为该处提示展示;
 *  - 行尾 `# 注释` 作为该行的引导注释展示给学生, 不参与比对;
 *  - 比对时忽略所有空白差异, 只比较代码内容本身。
 */

export interface RefLine {
  /** 原始行号(在教师代码中的行号, 1 起) */
  sourceLine: number;
  /** 去掉行尾注释后的代码(教师答案, 绝不下发给学生) */
  answer: string;
  /** 该行给学生看的引导注释 */
  hint: string;
  /** 比对用归一化结果 */
  norm: string;
}

function stripInlineComment(line: string): { code: string; hint: string } {
  const idx = line.indexOf("#");
  if (idx === -1) return { code: line.trim(), hint: "" };
  return {
    code: line.slice(0, idx).trim(),
    hint: line.slice(idx + 1).trim(),
  };
}

function normalize(line: string): string {
  return line.replace(/\s+/g, "");
}

/** 解析教师参考代码 → 逐行定义 */
export function parseReferenceCode(code: string): RefLine[] {
  const out: RefLine[] = [];
  const lines = code.replace(/\r/g, "").split("\n");
  let pendingHint = "";
  lines.forEach((raw, i) => {
    const { code: codePart, hint } = stripInlineComment(raw);
    if (!codePart) {
      // 空行或整行注释: 累积为下一条有效行的附加提示
      if (hint) pendingHint = pendingHint ? `${pendingHint};${hint}` : hint;
      return;
    }
    out.push({
      sourceLine: i + 1,
      answer: codePart,
      hint: [pendingHint, hint].filter(Boolean).join(";"),
      norm: normalize(codePart),
    });
    pendingHint = "";
  });
  return out;
}

export interface LineResult {
  index: number;
  sourceLine: number;
  correct: boolean;
  studentNorm: string;
}

export interface VerifyResult {
  results: LineResult[];
  total: number;
  correct: number;
  score: number;
  allCorrect: boolean;
}

/** 逐行比对学生输入与参考代码 */
export function verifyStudentCode(
  studentLines: string[],
  reference: RefLine[]
): VerifyResult {
  const results: LineResult[] = reference.map((ref, i) => {
    const studentNorm = normalize(studentLines[i] ?? "");
    return {
      index: i,
      sourceLine: ref.sourceLine,
      correct: studentNorm === ref.norm,
      studentNorm,
    };
  });
  const total = reference.length;
  const correct = results.filter((r) => r.correct).length;
  return {
    results,
    total,
    correct,
    score: total ? Math.round((correct / total) * 100) : 0,
    allCorrect: total > 0 && correct === total,
  };
}
