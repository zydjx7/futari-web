document.addEventListener("click", event => {
  const add = event.target.closest("[data-add-dish]");
  if (add) {
    const row = document.querySelector("#dish-template").content.cloneNode(true);
    row.querySelector('[name="id"]').value = crypto.randomUUID();
    const input = row.querySelector('[name="name"]');
    document.querySelector("#dish-rows").append(row);
    input.focus();
  }
  const remove = event.target.closest("[data-remove-dish]");
  if (remove) remove.closest(".dish-edit").remove();
});

document.addEventListener("submit", async event => {
  const form = event.target;
  if (!form.matches("form[data-editor]")) return;
  event.preventDefault();
  if (form.dataset.sending) return;
  const status = form.querySelector('[role="alert"]');
  const button = form.querySelector('button.primary');
  form.dataset.sending = "1";
  status.textContent = "";
  button.disabled = true;
  try {
    const response = await fetch(form.action, { method: "POST", body: new FormData(form),
      headers: { Accept: "application/json" } });
    if (response.status === 401) throw new Error("登录已过期，请在另一标签页重新登录后重试");
    if (!response.ok) throw new Error((await response.json()).error || "保存失败，请重试");
    const { location: destination } = await response.json();
    location.assign(destination);
  } catch (error) {
    status.textContent = error instanceof TypeError ? "连接失败，请重试" : error.message;
  } finally {
    delete form.dataset.sending;
    button.disabled = false;
  }
});
