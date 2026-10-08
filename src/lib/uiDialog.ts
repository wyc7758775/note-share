// 自绘的 prompt/confirm 对话框。
// 不用 window.prompt/confirm：部分 webview（包括某些内嵌浏览器和 Tauri 场景）
// 不支持原生 JS 对话框，功能会直接失效。
export function uiPrompt(
  message: string,
  defaultValue = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = shell();
    overlay.innerHTML = `
      <div class="ui-dialog">
        <div class="ui-msg"></div>
        <input class="ui-input" type="text">
        <div class="ui-row">
          <button class="btn-ghost" data-act="cancel">取消</button>
          <button class="btn-primary" data-act="ok">确定</button>
        </div>
      </div>`;
    const msg = overlay.querySelector(".ui-msg")!;
    const input = overlay.querySelector<HTMLInputElement>(".ui-input")!;
    msg.textContent = message;
    input.value = defaultValue;

    const close = (val: string | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") close(input.value);
      if (e.key === "Escape") close(null);
    };
    overlay.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.act === "ok") close(input.value);
      else if (t.dataset.act === "cancel" || t === overlay) close(null);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

export function uiConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = shell();
    overlay.innerHTML = `
      <div class="ui-dialog">
        <div class="ui-msg"></div>
        <div class="ui-row">
          <button class="btn-ghost" data-act="cancel">取消</button>
          <button class="btn-primary" data-act="ok">确定</button>
        </div>
      </div>`;
    overlay.querySelector(".ui-msg")!.textContent = message;
    const close = (val: boolean) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") close(true);
      if (e.key === "Escape") close(false);
    };
    overlay.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.act === "ok") close(true);
      else if (t.dataset.act === "cancel" || t === overlay) close(false);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
}

function shell(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "ui-dialog-overlay";
  return d;
}
