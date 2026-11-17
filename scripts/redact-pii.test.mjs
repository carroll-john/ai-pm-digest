import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPii, redactFailureRecord } from "./redact-pii.mjs";

test("redacts emails, bearer tokens, and vendor API keys", () => {
  const out = redactPii(
    'to jane@example.com Bearer sk-ant-api03-ABCDEFG123 re_abc123XYZ Authorization: Bearer abc.def-ghi',
  );
  assert.equal(out.includes("jane@example.com"), false);
  assert.equal(out.includes("sk-ant-"), false);
  assert.equal(out.includes("re_abc123XYZ"), false);
  assert.match(out, /\[REDACTED_EMAIL\]/);
  assert.match(out, /\[REDACTED_TOKEN\]/);
});

test("redactFailureRecord redacts detail and truncates it", () => {
  const record = redactFailureRecord({
    kind: "ANTHROPIC_AUTH",
    summary: "failed for jane@example.com",
    hint: "rotate sk-ant-api03-SECRETKEY",
    detail: `key=sk-ant-api03-${"A".repeat(3000)}`,
  });
  assert.equal(record.summary.includes("jane@example.com"), false);
  assert.equal(record.hint.includes("sk-ant-"), false);
  assert.equal(record.detail.length <= 2000, true);
  assert.equal(record.kind, "ANTHROPIC_AUTH");
});
