import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parsePagination,
} from "../src/lib/pagination.ts";

test("pagination applies safe defaults and clamps oversized requests", () => {
  const pagination = parsePagination(
    new URLSearchParams({ page: "-2", pageSize: "100000" }),
  );

  assert.equal(pagination.page, 1);
  assert.equal(pagination.pageSize, MAX_PAGE_SIZE);
  assert.equal(pagination.skip, 0);
});

test("pagination accepts valid page values", () => {
  const pagination = parsePagination(
    new URLSearchParams({ page: "3", pageSize: String(DEFAULT_PAGE_SIZE) }),
  );

  assert.equal(pagination.page, 3);
  assert.equal(pagination.pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(pagination.skip, DEFAULT_PAGE_SIZE * 2);
});
