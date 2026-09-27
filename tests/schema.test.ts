import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, parseHousehold, SchemaError } from "../src/domain/schema.ts";
import { demo } from "./fixtures.ts";

describe("household schema", () => {
  it("accepts the current demo household", () => {
    expect(parseHousehold(demo()).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("migrates MVP data saved without a schemaVersion", () => {
    const { schemaVersion: _drop, ...legacy } = demo();
    expect(parseHousehold(legacy).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("refuses data from a newer version instead of guessing", () => {
    expect(() => parseHousehold({ ...demo(), schemaVersion: 99 })).toThrow(/newer FamilyVault/);
  });

  it.each([
    ["not an object", 42],
    ["missing arrays", { ...demo(), people: undefined }],
    ["non-array collections", { ...demo(), people: "nope", assets: 7, fiduciaries: {} }],
    ["bad status", { ...demo(), maritalStatus: { value: "married", status: "sure" } }],
    ["full account number", { ...demo(), assets: [{ ...demo().assets[1], refLast4: ["1234", "56789"].join("") }] }],
    ["duplicate person id", { ...demo(), people: [demo().people[0], demo().people[0]] }],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseHousehold(raw)).toThrow(SchemaError);
  });
});
