import { parseReferenceCode, verifyStudentCode } from "../lib/codecheck";

const ref = parseReferenceCode(`from sklearn.datasets import load_iris  # 加载鸢尾花数据集

model = LogisticRegression()  # 创建逻辑回归模型
model.fit(X_train, y_train) # 训练模型
print(model.score(X_test, y_test))  # 输出准确率`);
console.log("有效行数:", ref.length, "(空行/整行注释已剔除)");
console.log("各行提示:", JSON.stringify(ref.map((r) => r.hint)));

const ok = verifyStudentCode(
  ["from sklearn.datasets import load_iris", "model=LogisticRegression()", "model.fit(X_train,  y_train)", "print(model.score(X_test, y_test))"],
  ref
);
console.log("输入正确: 全对 =", ok.allCorrect, "得分 =", ok.score);

const bad = verifyStudentCode(
  ["from sklearn.datasets import load_iris", "model = LinearRegression()", "model.fit(X_train, y_train)", "print(model.score(X_test, y_test))"],
  ref
);
console.log("第2行写错: 正确", bad.correct, "/", bad.total, "第2行标记 =", bad.results[1].correct);
console.log("行数不足: 正确", verifyStudentCode(["from sklearn.datasets import load_iris"], ref).correct, "/", ref.length);
