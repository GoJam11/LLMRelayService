import { describe, expect, it } from "bun:test";
import { prepareRequestForProvider } from "../src/providers";

function prepare(payload: unknown, claudeCodeCompat = true) {
  const result = prepareRequestForProvider({
    upstreamType: "anthropic",
    method: "POST",
    rawBodyText: JSON.stringify(payload),
    rawHeaders: new Headers(),
    claudeCodeCompat,
  });
  return JSON.parse(result.body ?? "{}") as Record<string, any>;
}

const USER_TURN = { role: "user", content: "你好" };

describe("claudeCodeCompat: system 搬进第一条 user 消息", () => {
  it("字符串 system 搬进首条 user 消息并从请求体删除", () => {
    const body = prepare({
      model: "claude-sonnet-5",
      system: "你是 ChatFlex。",
      messages: [USER_TURN],
    });

    expect(body.system).toBeUndefined();
    expect(body.messages[0].content[0].text).toContain("你是 ChatFlex。");
    expect(body.messages[0].content[0].text).toContain("<system_instructions>");
    // 用户原文保留在后面，不被吞掉
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: "你好" });
  });

  it("block 数组 system 合并文本，并把末块的 cache_control 带过去", () => {
    const body = prepare({
      model: "claude-sonnet-5",
      system: [
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段", cache_control: { type: "ephemeral", ttl: "5m" } },
      ],
      messages: [USER_TURN],
    });

    expect(body.system).toBeUndefined();
    expect(body.messages[0].content[0].text).toContain("第一段");
    expect(body.messages[0].content[0].text).toContain("第二段");
    expect(body.messages[0].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  it("多模态 user 内容：文本块插在最前面，其余块原样保留", () => {
    const body = prepare({
      model: "claude-sonnet-5",
      system: "你是 ChatFlex。",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "xx" } },
            { type: "text", text: "这是什么" },
          ],
        },
      ],
    });

    expect(body.messages[0].content).toHaveLength(3);
    expect(body.messages[0].content[0].text).toContain("你是 ChatFlex。");
    expect(body.messages[0].content[1].type).toBe("image");
  });

  it("搬进的是第一条 user 消息，而不是第一条消息", () => {
    const body = prepare({
      model: "claude-sonnet-5",
      system: "你是 ChatFlex。",
      messages: [
        { role: "assistant", content: "上一轮回复" },
        USER_TURN,
      ],
    });

    expect(body.messages[0]).toEqual({ role: "assistant", content: "上一轮回复" });
    expect(body.messages[1].content[0].text).toContain("你是 ChatFlex。");
  });

  it("没有 user 消息时不动 system —— 没地方搬，留给上游处理", () => {
    const body = prepare({
      model: "claude-sonnet-5",
      system: "你是 ChatFlex。",
      messages: [{ role: "assistant", content: "只有 assistant" }],
    });

    expect(body.system).toBe("你是 ChatFlex。");
  });

  it("空 system 不产生空块", () => {
    const body = prepare({
      model: "claude-sonnet-5",
      system: "   ",
      messages: [USER_TURN],
    });

    expect(body.system).toBe("   ");
    expect(body.messages[0].content).toBe("你好");
  });

  it("开关关闭时完全不改请求体", () => {
    const body = prepare(
      { model: "claude-sonnet-5", system: "你是 ChatFlex。", messages: [USER_TURN] },
      false,
    );

    expect(body.system).toBe("你是 ChatFlex。");
    expect(body.messages[0].content).toBe("你好");
  });
});
