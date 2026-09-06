// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EntityHoverPreview, __resetPreviewCacheForTests } from "./EntityHoverPreview.js";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  __resetPreviewCacheForTests();
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const response=(content:string)=>({ok:true,json:async()=>({memories:[{content,createdAt:"2026-09-06T00:00:00Z"}]})});
describe("entity preview changes",()=>{
 it("switches content when the hovered entity changes without remounting the caller",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>response(url.includes("entity-a")?"Synthetic Alpha":"Synthetic Beta")));
  await act(async()=>root.render(createElement(EntityHoverPreview,{entityId:"entity-a",relatedCount:1})));
  expect(host.textContent).toContain("Synthetic Alpha");
  await act(async()=>root.render(createElement(EntityHoverPreview,{entityId:"entity-b",relatedCount:2})));
  expect(host.textContent).toContain("Synthetic Beta"); expect(host.textContent).not.toContain("Synthetic Alpha");
 });
 it("ignores a previous entity response that finishes after the current response",async()=>{
  let finishA!:(value:unknown)=>void;
  vi.stubGlobal("fetch",vi.fn((url:string)=>url.includes("entity-a")?new Promise(resolve=>{finishA=resolve}):Promise.resolve(response("Synthetic Beta"))));
  await act(async()=>root.render(createElement(EntityHoverPreview,{entityId:"entity-a",relatedCount:1})));
  await act(async()=>root.render(createElement(EntityHoverPreview,{entityId:"entity-b",relatedCount:2})));
  await act(async()=>finishA(response("Synthetic Alpha")));
  expect(host.textContent).toContain("Synthetic Beta");expect(host.textContent).not.toContain("Synthetic Alpha");
 });
});
