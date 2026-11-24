import { test } from "node:test";
import assert from "node:assert/strict";
import { handleShortcut } from "../ui/shortcuts.js";

test("Mac window shortcuts switch the pet or wallpaper and yield to editing", () => {
  const calls = [];
  const invoke = async (cmd, args) => calls.push([cmd, args.key]);
  const keys = ["⌥J", "⌥K"];
  const event = { altKey: true, code: "KeyJ", preventDefault() {} };
  const press = change => handleShortcut({ ...event, ...change }, invoke, keys, true);
  assert.equal(press({}), true);
  assert.equal(press({ code: "KeyK" }), true);
  assert.equal(press({ repeat: true }), true);
  assert.equal(handleShortcut(event, invoke, [null, keys[1]], true), false);
  for (const change of [
    { metaKey: true }, { altKey: false }, { ctrlKey: true }, { shiftKey: true },
    { isComposing: true }, { defaultPrevented: true }, { target: { isContentEditable: true } },
    { target: { closest: selector => selector.includes("textarea") } },
    { altKey: true, ctrlKey: false, shiftKey: false, code: "KeyW" }
  ]) assert.equal(press(change), false);
  assert.deepEqual(calls, [["focused_shortcut", "toggle"], ["focused_shortcut", "switch"]]);
});

test("focused windows handle Alt+Q/W once and leave other combinations alone", () => {
  const calls = [];
  const invoke = async (cmd, args) => calls.push([cmd, args.key]);
  let prevented = 0;
  const event = { altKey: true, code: "KeyQ", preventDefault: () => prevented++ };
  assert.equal(handleShortcut(event, invoke, undefined, false), true);
  assert.equal(handleShortcut({ ...event, repeat: true }, invoke, undefined, false), true);
  assert.equal(handleShortcut({ ...event, code: "KeyW" }, invoke, undefined, false), true);
  for (const change of [{ altKey: false }, { ctrlKey: true }, { shiftKey: true },
    { metaKey: true }, { isComposing: true }, { code: "KeyE" }]) {
    assert.equal(handleShortcut({ ...event, ...change }, invoke, undefined, false), false);
  }
  assert.equal(prevented, 3);
  assert.deepEqual(calls, [["focused_shortcut", "toggle"], ["focused_shortcut", "switch"]]);
});
