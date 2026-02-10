import { createRequestHandler } from "@netlify/remix-adapter";
import { b as build } from "./assets/server-build-CwsyuJU3.js";
import "react/jsx-runtime";
import "node:stream";
import "@remix-run/node";
import "@remix-run/react";
import "isbot";
import "react-dom/server";
import "@supabase/supabase-js";
import "react";
import "shiki";
const _virtual_netlifyServer = createRequestHandler({
  build,
  getLoadContext: async (_req, ctx) => ctx
});
export {
  _virtual_netlifyServer as default
};
