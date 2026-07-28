import test from "node:test";
import assert from "node:assert/strict";

import { formatLocalizedEventLines, sideLabel, translateEventText } from "../src/ui/lang.js";

test("Chinese tactical feed localization preserves identifiers and translates full sentences", () => {
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

test("event localization normalizes approximate enemy hull labels", () => {
  assert.equal(
    translateEventText("Blue DDG 1 launched MSTK at Arleigh Burke Flight IIA approx.."),
    "蓝方 DDG 1 向 敌方 DDG 发射 MSTK。"
  );
});

test("formatted event lines use Chinese and do not duplicate the side", () => {
  const events = [{ t: 49, side: "BLUE", text: "Blue DDG 1 launched MSTK at Arleigh Burke Flight IIA approx.." }];
  const time = () => "00:49";

  assert.equal(formatLocalizedEventLines(events, time), "00:49 蓝方 DDG 1 向 敌方 DDG 发射 MSTK。");
});

test("event side labels accept simulation-side values as well as legacy uppercase values", () => {
  assert.equal(sideLabel("Blue"), "蓝");
  assert.equal(sideLabel("Red"), "红");
  assert.equal(sideLabel("BLUE"), "蓝");
  assert.equal(sideLabel("RED"), "红");
});
