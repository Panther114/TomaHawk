import test from "node:test";
import assert from "node:assert/strict";

import { formatLocalizedEventLines, setLang, sideLabel, translateEventText } from "../src/ui/lang.js";

test("Chinese tactical feed localization preserves identifiers and translates full sentences", () => {
  setLang("zh");

  assert.equal(
    translateEventText("BLUE DDG-1 launched SM-6 at RED DDG-2."),
    "蓝方 DDG-1 向 红方 DDG-2 发射 SM-6。"
  );
  assert.equal(
    translateEventText("SM-2MR intercepted incoming SM-6."),
    "SM-2MR 拦截来袭的 SM-6。"
  );
  assert.equal(
    translateEventText("BLUE side controls the battlespace. Simulation ended."),
    "蓝方控制战场，推演结束。"
  );
  assert.equal(translateEventText("Blue DDG placed."), "蓝方 DDG 已部署。");
  assert.equal(
    translateEventText("Red DDG 2 queued 5x MSTK salvo at Arleigh Burke Flight IIA approx."),
    "红方 DDG 2 已安排使用 5x MSTK 齐射攻击 敌方 DDG。"
  );
});

test("English tactical feed uses concise enemy hull labels", () => {
  setLang("en");
  assert.equal(
    translateEventText("Blue DDG 1 launched MSTK at Arleigh Burke Flight IIA approx.."),
    "Blue DDG 1 launched MSTK at enemy DDG."
  );
});

test("copied event lines use the active language and do not duplicate the side", () => {
  const events = [{ t: 49, side: "BLUE", text: "Blue DDG 1 launched MSTK at Arleigh Burke Flight IIA approx.." }];
  const time = () => "00:49";

  setLang("en");
  assert.equal(formatLocalizedEventLines(events, time), "00:49 Blue DDG 1 launched MSTK at enemy DDG.");

  setLang("zh");
  assert.equal(formatLocalizedEventLines(events, time), "00:49 蓝方 DDG 1 向 敌方 DDG 发射 MSTK。");
});

test("event side labels accept simulation-side values as well as legacy uppercase values", () => {
  setLang("en");
  assert.equal(sideLabel("Blue"), "B");
  assert.equal(sideLabel("Red"), "R");
  assert.equal(sideLabel("BLUE"), "B");
  assert.equal(sideLabel("RED"), "R");
});
