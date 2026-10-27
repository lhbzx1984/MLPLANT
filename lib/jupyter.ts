/**
 * Jupyter 内核执行客户端
 *
 * 通过 Jupyter Server 的 REST API 远程执行学生代码:
 *   1. POST /api/kernels          启动 python3 内核
 *   2. WS  /api/kernels/{id}/channels  发送 execute_request, 收集 iopub 输出
 *   3. DELETE /api/kernels/{id}   关闭内核
 *
 * 配置 (.env.local):
 *   JUPYTER_EXECUTE_URL   Jupyter Server 地址, 如 http://<GPU服务器IP>:8888
 *   JUPYTER_EXECUTE_TOKEN Jupyter Server 的 token
 *
 * 输出比对: normalizeOutput 后与教师填写的「预期输出」全等比对。
 */

export interface ExecResult {
  executed: boolean;
  output: string;
  reason?: string;
}

/** 归一化输出: 统一换行、压缩行内空白、去掉空行与 ANSI 颜色码 */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

export function isJupyterConfigured(): boolean {
  return !!(process.env.JUPYTER_EXECUTE_URL && process.env.JUPYTER_EXECUTE_TOKEN);
}

interface IopubMessage {
  channel: string;
  header?: { msg_type?: string };
  content?: {
    text?: string;
    name?: string;
    data?: Record<string, string>;
    ename?: string;
    evalue?: string;
    traceback?: string[];
    execution_state?: string;
  };
}

export async function executeCode(code: string, timeoutMs = 60000): Promise<ExecResult> {
  if (!isJupyterConfigured()) {
    return {
      executed: false,
      output: "",
      reason:
        "平台未配置 Jupyter 执行环境:请在 .env.local 设置 JUPYTER_EXECUTE_URL 与 JUPYTER_EXECUTE_TOKEN(联系管理员)",
    };
  }

  const base = process.env.JUPYTER_EXECUTE_URL!.replace(/\/+$/, "");
  const token = process.env.JUPYTER_EXECUTE_TOKEN!;
  const headers = {
    Authorization: `token ${token}`,
    "Content-Type": "application/json",
  };

  // 1. 启动内核
  let kernelId: string;
  try {
    const kr = await fetch(`${base}/api/kernels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "python3" }),
      signal: AbortSignal.timeout(20000),
    });
    if (!kr.ok) {
      return { executed: false, output: "", reason: `Jupyter 内核启动失败: HTTP ${kr.status}` };
    }
    kernelId = ((await kr.json()) as { id: string }).id;
  } catch (e) {
    return {
      executed: false,
      output: "",
      reason:
        "无法连接 Jupyter 执行服务器: " +
        (e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)),
    };
  }

  try {
    // 2. WebSocket 执行
    const wsUrl = `${base.replace(/^http/, "ws")}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(token)}`;
    return await new Promise<ExecResult>((resolve) => {
      const collected: string[] = [];
      let settled = false;
      const ws = new WebSocket(wsUrl);

      const finish = (r: ExecResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(r);
      };

      const timer = setTimeout(() => {
        finish({
          executed: collected.length > 0,
          output: collected.join("\n").trim(),
          reason: collected.length > 0 ? "执行超时,已收集部分输出" : "内核执行超时",
        });
      }, timeoutMs);

      ws.onopen = () => {
        const now = new Date().toISOString();
        ws.send(
          JSON.stringify({
            header: {
              msg_id: crypto.randomUUID(),
              username: "ml-platform",
              session: crypto.randomUUID(),
              date: now,
              msg_type: "execute_request",
              version: "5.3",
            },
            parent_header: {},
            metadata: {},
            content: {
              code,
              silent: false,
              store_history: false,
              user_expressions: {},
              allow_stdin: false,
              stop_on_error: true,
            },
            buffers: [],
            channel: "shell",
          })
        );
      };

      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data)) as IopubMessage;
          if (m.channel !== "iopub") return;
          const t = m.header?.msg_type;
          if (t === "stream" && m.content?.text) {
            collected.push(m.content.text);
          } else if (t === "execute_result" && m.content?.data?.["text/plain"]) {
            collected.push(String(m.content.data["text/plain"]));
          } else if (t === "error") {
            const tb = (m.content?.traceback ?? []).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
            collected.push(`【运行出错】${m.content?.ename}: ${m.content?.evalue}\n${tb}`);
          } else if (t === "status" && m.content?.execution_state === "idle") {
            finish({ executed: true, output: collected.join("\n").trim() });
          }
        } catch {
          /* 忽略解析失败的消息 */
        }
      };

      ws.onerror = () =>
        finish({ executed: false, output: "", reason: "连接 Jupyter 内核 WebSocket 失败" });
      ws.onclose = () =>
        finish({
          executed: collected.length > 0,
          output: collected.join("\n").trim(),
          reason: collected.length > 0 ? undefined : "内核连接提前关闭",
        });
    });
  } finally {
    // 3. 关闭内核(无论成败)
    fetch(`${base}/api/kernels/${kernelId}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
}
