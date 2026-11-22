export function mountNameEditor(dialog, save, signal) {
  const trigger = dialog.querySelector(".rabbit-name-trigger");
  const title = dialog.querySelector("#room-title");
  const heading = trigger.closest("h2");
  const form = dialog.querySelector(".rabbit-name-form");
  const input = form.elements.name;
  const confirm = form.querySelector("button");
  const help = dialog.querySelector(".rabbit-name-help");
  const cancel = help.querySelector("button");
  const message = dialog.querySelector("#rabbit-name-message");
  const hint = "1–12 个字";
  let current, saving = false;

  function setName(name) {
    if (current === name) return;
    current = name;
    title.textContent = name + "的窝";
    trigger.title = "给" + name + "改名";
    trigger.setAttribute("aria-label", trigger.title);
    trigger.disabled = false;
  }
  function finish() {
    form.hidden = help.hidden = true;
    heading.hidden = false;
    input.value = current;
    input.removeAttribute("aria-invalid");
    trigger.focus({ preventScroll: true });
  }
  trigger.addEventListener("click", () => {
    input.value = current;
    message.textContent = hint;
    heading.hidden = true;
    form.hidden = help.hidden = false;
    input.focus({ preventScroll: true });
    input.select();
  }, { signal });
  cancel.addEventListener("click", finish, { signal });
  input.addEventListener("input", () => {
    if (message.textContent !== hint) message.textContent = hint;
    input.removeAttribute("aria-invalid");
  }, { signal });
  dialog.addEventListener("cancel", (event) => {
    if (form.hidden) return;
    event.preventDefault();
    if (!saving) finish();
  }, { signal });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || form.hidden) return;
    if (input.value.trim() === current) return finish();
    saving = input.readOnly = confirm.disabled = cancel.disabled = true;
    input.removeAttribute("aria-invalid");
    message.textContent = "正在记下名字…";
    try {
      const name = await save(input.value);
      if (signal.aborted) return;
      setName(name);
      finish();
    } catch (error) {
      if (signal.aborted) return;
      message.textContent = error.status ? error.message : "名字还没记下来，再点一下小勾试试。";
      if (error.status === 422) input.setAttribute("aria-invalid", "true");
      input.focus({ preventScroll: true });
    } finally {
      saving = input.readOnly = confirm.disabled = cancel.disabled = false;
    }
  }, { signal });
  return setName;
}
