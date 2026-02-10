import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable, createCookieSessionStorage, redirect } from "@remix-run/node";
import { RemixServer, Meta, Links, Outlet, ScrollRestoration, Scripts, Link, useLoaderData, useActionData, useNavigation, Form, NavLink, useSubmit } from "@remix-run/react";
import * as isbotModule from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import React, { useRef, useEffect, useState } from "react";
import { createHighlighter } from "shiki";
const ABORT_DELAY = 5e3;
function handleRequest(request, responseStatusCode, responseHeaders, remixContext, loadContext) {
  let prohibitOutOfOrderStreaming = isBotRequest(request.headers.get("user-agent")) || remixContext.isSpaMode;
  return prohibitOutOfOrderStreaming ? handleBotRequest(
    request,
    responseStatusCode,
    responseHeaders,
    remixContext
  ) : handleBrowserRequest(
    request,
    responseStatusCode,
    responseHeaders,
    remixContext
  );
}
function isBotRequest(userAgent) {
  if (!userAgent) {
    return false;
  }
  if ("isbot" in isbotModule && typeof isbotModule.isbot === "function") {
    return isbotModule.isbot(userAgent);
  }
  if ("default" in isbotModule && typeof isbotModule.default === "function") {
    return isbotModule.default(userAgent);
  }
  return false;
}
function handleBotRequest(request, responseStatusCode, responseHeaders, remixContext) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(
        RemixServer,
        {
          context: remixContext,
          url: request.url,
          abortDelay: ABORT_DELAY
        }
      ),
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        }
      }
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
function handleBrowserRequest(request, responseStatusCode, responseHeaders, remixContext) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(
        RemixServer,
        {
          context: remixContext,
          url: request.url,
          abortDelay: ABORT_DELAY
        }
      ),
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        }
      }
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest
}, Symbol.toStringTag, { value: "Module" }));
const styles = "/assets/tailwind-BZjvUeSM.css";
const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous"
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
  },
  { rel: "stylesheet", href: styles }
];
function App() {
  return /* @__PURE__ */ jsxs("html", { lang: "en", children: [
    /* @__PURE__ */ jsxs("head", { children: [
      /* @__PURE__ */ jsx("meta", { charSet: "utf-8" }),
      /* @__PURE__ */ jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      /* @__PURE__ */ jsx(Meta, {}),
      /* @__PURE__ */ jsx(Links, {})
    ] }),
    /* @__PURE__ */ jsxs("body", { className: "flex flex-col min-h-screen text-slate-700 bg-slate-100", children: [
      /* @__PURE__ */ jsx(Outlet, {}),
      /* @__PURE__ */ jsx(ScrollRestoration, {}),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: App,
  links
}, Symbol.toStringTag, { value: "Module" }));
const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET ?? "s3cr3t"],
    secure: process.env.NODE_ENV === "production"
  }
});
const { getSession, commitSession, destroySession } = sessionStorage;
const session_server = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  commitSession,
  destroySession,
  getSession,
  sessionStorage
}, Symbol.toStringTag, { value: "Module" }));
function getSupabaseClient$1() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_DATABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}
const getSupabaseClient$2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getSupabaseClient: getSupabaseClient$1
}, Symbol.toStringTag, { value: "Module" }));
async function getSessionUser(request) {
  const session = await getSession(request.headers.get("Cookie"));
  const accessToken = session.get("access_token");
  const refreshToken = session.get("refresh_token");
  if (!accessToken || !refreshToken) {
    return null;
  }
  const supabase = getSupabaseClient$1();
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    accessToken,
    refreshToken
  };
}
async function requireUser(request) {
  const user = await getSessionUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return user;
}
async function clearSession(response) {
  const session = await getSession();
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      "Set-Cookie": await destroySession(session)
    }
  });
}
function LoadingSpinner() {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      className: "h-5 w-5 animate-spin text-slate-500",
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      viewBox: "0 0 24 24",
      children: [
        /* @__PURE__ */ jsx(
          "circle",
          {
            className: "opacity-25",
            cx: "12",
            cy: "12",
            r: "10",
            stroke: "currentColor",
            strokeWidth: "4"
          }
        ),
        /* @__PURE__ */ jsx(
          "path",
          {
            className: "opacity-75",
            fill: "currentColor",
            d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          }
        )
      ]
    }
  );
}
const baseStyles = "group inline-flex items-center justify-center gap-1 py-3 px-6 text-sm/5 tracking-wide rounded-md transition focus:outline-none";
const variantStyles = {
  contained: "bg-cyan-500 text-white hover:bg-cyan-500/90",
  outlined: "bg-transparent text-cyan-600 ring ring-cyan-300 hover:bg-cyan-50"
};
const Button = React.forwardRef(function Button2({
  variant = "contained",
  children,
  className,
  loading = false,
  disabled = false,
  target,
  to,
  onClick,
  ...rest
}, ref) {
  return /* @__PURE__ */ jsx(Fragment, { children: to ? /* @__PURE__ */ jsx(
    Link,
    {
      to,
      className: [baseStyles, variantStyles[variant], className].filter(Boolean).join(" "),
      target,
      children
    }
  ) : /* @__PURE__ */ jsxs(
    "button",
    {
      ref,
      disabled,
      onClick,
      className: [
        baseStyles,
        disabled || loading ? "opacity-50 bg-slate-700 text-white hover:bg-slate-700 hover:text-white" : variantStyles[variant],
        "cursor-pointer relative",
        className
      ].filter(Boolean).join(" "),
      ...rest,
      children: [
        loading && /* @__PURE__ */ jsx("span", { className: "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", children: /* @__PURE__ */ jsx(LoadingSpinner, {}) }),
        /* @__PURE__ */ jsx("span", { className: loading ? "invisible" : void 0, children })
      ]
    }
  ) });
});
const meta$5 = () => {
  return [{ title: "Channels | Marginality Admin" }];
};
async function loader$5({ request }) {
  await requireUser(request);
  const supabase = getSupabaseClient$1();
  const { data: channels, error: channelsError } = await supabase.from("external_channels").select("id, youtube_channel_id, title, handle, created_at").order("created_at", { ascending: false });
  if (channelsError) {
    console.error("Error fetching channels:", channelsError);
    return { channels: [], error: channelsError.message };
  }
  const channelsWithCounts = await Promise.all(
    (channels || []).map(async (channel) => {
      const { count: totalVideos } = await supabase.from("videos").select("*", { count: "exact", head: true }).eq("external_channel_id", channel.id);
      const { count: unindexedVideos } = await supabase.from("videos").select("*", { count: "exact", head: true }).eq("external_channel_id", channel.id).in("indexing_status", ["not_indexed", "pending"]);
      return {
        ...channel,
        total_videos: totalVideos || 0,
        unindexed_videos: unindexedVideos || 0
      };
    })
  );
  return { channels: channelsWithCounts };
}
function ChannelsIndex() {
  const { channels } = useLoaderData();
  return /* @__PURE__ */ jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold text-slate-900", children: "Channels" }),
      /* @__PURE__ */ jsx(Link, { to: "/channels/new", children: /* @__PURE__ */ jsx(Button, { children: "Create Channel" }) })
    ] }),
    channels.length === 0 ? /* @__PURE__ */ jsx("div", { className: "p-8 text-center bg-white rounded-lg shadow", children: /* @__PURE__ */ jsx("p", { className: "text-slate-600", children: "No channels yet. Create your first channel to get started." }) }) : /* @__PURE__ */ jsx("div", { className: "overflow-hidden bg-white shadow rounded-lg", children: /* @__PURE__ */ jsxs("table", { className: "min-w-full divide-y divide-slate-200", children: [
      /* @__PURE__ */ jsx("thead", { className: "bg-slate-50", children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { className: "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500", children: "Channel" }),
        /* @__PURE__ */ jsx("th", { className: "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500", children: "YouTube ID" }),
        /* @__PURE__ */ jsx("th", { className: "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500", children: "Total Videos" }),
        /* @__PURE__ */ jsx("th", { className: "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500", children: "Unindexed" }),
        /* @__PURE__ */ jsx("th", { className: "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500", children: "Actions" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { className: "bg-white divide-y divide-slate-200", children: channels.map((channel) => /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsxs("td", { className: "px-6 py-4 whitespace-nowrap", children: [
          /* @__PURE__ */ jsx("div", { className: "text-sm font-medium text-slate-900", children: channel.title }),
          channel.handle && /* @__PURE__ */ jsxs("div", { className: "text-sm text-slate-500", children: [
            "@",
            channel.handle
          ] })
        ] }),
        /* @__PURE__ */ jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: /* @__PURE__ */ jsx("div", { className: "text-sm text-slate-500", children: channel.youtube_channel_id }) }),
        /* @__PURE__ */ jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-slate-500", children: channel.total_videos }),
        /* @__PURE__ */ jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-slate-500", children: channel.unindexed_videos }),
        /* @__PURE__ */ jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm font-medium", children: /* @__PURE__ */ jsx(
          Link,
          {
            to: `/channels/${channel.id}`,
            className: "text-cyan-600 hover:text-cyan-900",
            children: "View"
          }
        ) })
      ] }, channel.id)) })
    ] }) })
  ] });
}
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ChannelsIndex,
  loader: loader$5,
  meta: meta$5
}, Symbol.toStringTag, { value: "Module" }));
const meta$4 = () => {
  return [{ title: "Channel Details | Marginality Admin" }];
};
async function loader$4({ request }) {
  await requireUser(request);
  const url = new URL(request.url);
  const channelId = url.pathname.split("/").pop();
  if (!channelId) {
    throw new Response("Channel ID required", { status: 400 });
  }
  const supabase = getSupabaseClient$1();
  const { data: channel, error: channelError } = await supabase.from("external_channels").select("*").eq("id", channelId).single();
  if (channelError || !channel) {
    throw new Response("Channel not found", { status: 404 });
  }
  const { count: totalVideos } = await supabase.from("videos").select("*", { count: "exact", head: true }).eq("external_channel_id", channelId);
  const { count: unindexedVideos } = await supabase.from("videos").select("*", { count: "exact", head: true }).eq("external_channel_id", channelId).in("indexing_status", ["not_indexed", "pending"]);
  return {
    channel,
    totalVideos: totalVideos || 0,
    unindexedVideos: unindexedVideos || 0
  };
}
async function action$3({ request }) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const channelId = formData.get("channel_id");
  const limit = formData.get("limit");
  if (typeof channelId !== "string") {
    return Response.json(
      { error: "Channel ID is required" },
      { status: 400 }
    );
  }
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
    }
    const url = `${supabaseUrl}/functions/v1/import_channel_videos_admin`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`
      },
      body: JSON.stringify({
        externalChannelId: channelId,
        limit: limit ? parseInt(limit) : void 0
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      return Response.json(
        { error: error.error || "Failed to import videos" },
        { status: response.status }
      );
    }
    const data = await response.json();
    return Response.json({ success: true, result: data });
  } catch (error) {
    return Response.json(
      { error: error.message || "Failed to import videos" },
      { status: 500 }
    );
  }
}
function ChannelDetail() {
  const { channel, totalVideos, unindexedVideos } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  return /* @__PURE__ */ jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold text-slate-900", children: channel.title }),
        channel.handle && /* @__PURE__ */ jsxs("p", { className: "text-sm text-slate-600", children: [
          "@",
          channel.handle
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        "a",
        {
          href: "/channels",
          className: "text-sm text-cyan-600 hover:text-cyan-900",
          children: "← Back to Channels"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-3", children: [
      /* @__PURE__ */ jsxs("div", { className: "p-4 bg-white rounded-lg shadow", children: [
        /* @__PURE__ */ jsx("div", { className: "text-sm font-medium text-slate-500", children: "YouTube Channel ID" }),
        /* @__PURE__ */ jsx("div", { className: "mt-1 text-lg font-semibold text-slate-900", children: channel.youtube_channel_id })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "p-4 bg-white rounded-lg shadow", children: [
        /* @__PURE__ */ jsx("div", { className: "text-sm font-medium text-slate-500", children: "Total Videos" }),
        /* @__PURE__ */ jsx("div", { className: "mt-1 text-lg font-semibold text-slate-900", children: totalVideos })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "p-4 bg-white rounded-lg shadow", children: [
        /* @__PURE__ */ jsx("div", { className: "text-sm font-medium text-slate-500", children: "Unindexed Videos" }),
        /* @__PURE__ */ jsx("div", { className: "mt-1 text-lg font-semibold text-slate-900", children: unindexedVideos })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "p-6 bg-white rounded-lg shadow", children: [
      /* @__PURE__ */ jsx("h2", { className: "mb-4 text-lg font-semibold text-slate-900", children: "Import Videos" }),
      (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", { className: "p-3 mb-4 text-sm rounded-md bg-rose-50 text-rose-700", children: actionData.error }),
      (actionData == null ? void 0 : actionData.success) && actionData.result && /* @__PURE__ */ jsxs("div", { className: "p-4 mb-4 rounded-md bg-green-50", children: [
        /* @__PURE__ */ jsx("h3", { className: "mb-2 font-medium text-green-900", children: "Import Complete" }),
        /* @__PURE__ */ jsx("pre", { className: "text-xs overflow-auto text-green-800", children: JSON.stringify(actionData.result, null, 2) })
      ] }),
      /* @__PURE__ */ jsxs(Form, { method: "POST", className: "space-y-4", children: [
        /* @__PURE__ */ jsx("input", { type: "hidden", name: "channel_id", value: channel.id }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "limit", className: "block text-sm font-medium text-slate-700", children: "Limit (optional, default: 50)" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              id: "limit",
              name: "limit",
              min: "1",
              max: "200",
              defaultValue: "50",
              className: "mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-cyan-500 focus:border-cyan-500"
            }
          )
        ] }),
        /* @__PURE__ */ jsx(Button, { type: "submit", loading: isSubmitting, children: "Import Videos" })
      ] })
    ] })
  ] });
}
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$3,
  default: ChannelDetail,
  loader: loader$4,
  meta: meta$4
}, Symbol.toStringTag, { value: "Module" }));
const TextField = React.forwardRef(
  function TextField2({
    id,
    name,
    type = "text",
    required = false,
    placeholder,
    className,
    label,
    ...rest
  }, ref) {
    return /* @__PURE__ */ jsxs("div", { children: [
      label && /* @__PURE__ */ jsxs(
        "label",
        {
          htmlFor: id,
          className: "block mb-2 text-sm tracking-wide text-slate-700",
          children: [
            label,
            " ",
            required && /* @__PURE__ */ jsx(
              "span",
              {
                title: "This field is required",
                "aria-label": "required",
                className: "text-cyan-600",
                children: "*"
              }
            )
          ]
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          ref,
          id,
          name,
          type,
          required,
          placeholder,
          className: [
            "block w-full rounded-md border p-3 text-sm text-slate-700 transition placeholder:font-light border-slate-200 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 focus:outline-none",
            className
          ].filter(Boolean).join(" "),
          ...rest
        }
      )
    ] });
  }
);
const meta$3 = () => {
  return [{ title: "Create Channel | Marginality Admin" }];
};
async function loader$3({ request }) {
  await requireUser(request);
  return null;
}
async function action$2({ request }) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const identifier = formData.get("identifier");
  if (typeof identifier !== "string" || !identifier.trim()) {
    return Response.json(
      { error: "YouTube channel identifier is required" },
      { status: 400 }
    );
  }
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
    }
    const url = `${supabaseUrl}/functions/v1/create_channel_admin`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`
      },
      body: JSON.stringify({ identifier: identifier.trim() })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      return Response.json(
        { error: error.error || "Failed to create channel" },
        { status: response.status }
      );
    }
    const data = await response.json();
    return redirect(`/channels/${data.channel.id}`);
  } catch (error) {
    return Response.json(
      { error: error.message || "Failed to create channel" },
      { status: 500 }
    );
  }
}
function ChannelsNew() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  return /* @__PURE__ */ jsxs("div", { className: "max-w-2xl space-y-6", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold text-slate-900", children: "Create Channel" }),
    /* @__PURE__ */ jsx("div", { className: "p-4 bg-white rounded-lg shadow", children: /* @__PURE__ */ jsxs(Form, { method: "POST", className: "space-y-4", children: [
      (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("p", { className: "p-3 text-sm rounded-md bg-rose-50 text-rose-700", children: actionData.error }),
      /* @__PURE__ */ jsxs("div", { className: "p-3 rounded-md bg-cyan-50", children: [
        /* @__PURE__ */ jsx("p", { className: "text-sm text-slate-700", children: "Enter a YouTube channel identifier:" }),
        /* @__PURE__ */ jsxs("ul", { className: "mt-2 ml-4 text-sm text-slate-600 list-disc", children: [
          /* @__PURE__ */ jsx("li", { children: "Channel ID (e.g., UC...)" }),
          /* @__PURE__ */ jsx("li", { children: "Handle (e.g., @channelname)" }),
          /* @__PURE__ */ jsx("li", { children: "Full URL (e.g., youtube.com/@channelname or youtube.com/channel/UC...)" })
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        TextField,
        {
          id: "identifier",
          name: "identifier",
          label: "YouTube Channel Identifier",
          required: true,
          placeholder: "UC... or @channelname or youtube.com/...",
          autoFocus: true
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "flex gap-3", children: [
        /* @__PURE__ */ jsx(Button, { type: "submit", loading: isSubmitting, children: "Create Channel" }),
        /* @__PURE__ */ jsx(
          "a",
          {
            href: "/channels",
            className: "px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50",
            children: "Cancel"
          }
        )
      ] })
    ] }) })
  ] });
}
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$2,
  default: ChannelsNew,
  loader: loader$3,
  meta: meta$3
}, Symbol.toStringTag, { value: "Module" }));
const Logo = () => {
  return /* @__PURE__ */ jsxs(Link, { to: "/", className: "flex items-center gap-3", children: [
    /* @__PURE__ */ jsxs(
      "svg",
      {
        width: "40",
        height: "40",
        viewBox: "0 0 40 40",
        xmlns: "http://www.w3.org/2000/svg",
        children: [
          /* @__PURE__ */ jsx(
            "path",
            {
              d: "M20 0C8.9543 0 0 8.82745 0 19.7167C11.0457 19.7167 20 10.8892 20 0Z",
              fill: "#CEFAFE"
            }
          ),
          /* @__PURE__ */ jsx(
            "path",
            {
              d: "M20 39.4333C31.0457 39.4333 40 30.6059 40 19.7167C28.9543 19.7167 20 28.5441 20 39.4333Z",
              fill: "#CEFAFE"
            }
          ),
          /* @__PURE__ */ jsx(
            "path",
            {
              d: "M20 0C31.0457 0 40 8.82745 40 19.7167C28.9543 19.7167 20 10.8892 20 0Z",
              fill: "#53EAFD"
            }
          ),
          /* @__PURE__ */ jsx(
            "path",
            {
              d: "M20 39.4333C8.9543 39.4333 -9.65645e-07 30.6059 0 19.7167C11.0457 19.7167 20 28.5441 20 39.4333Z",
              fill: "#53EAFD"
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx("span", { className: "text-xl text-slate-900 font-semibold uppercase", children: "Remix Admin" })
  ] });
};
function ArrowRight() {
  return /* @__PURE__ */ jsx(
    "svg",
    {
      className: "w-5 h-5 fill-current",
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      children: /* @__PURE__ */ jsx("path", { d: "M18.646 12.74h-15.406q-0.319 0-0.534-0.216t-0.216-0.535 0.216-0.534 0.534-0.215h15.406l-4.337-4.352q-0.204-0.205-0.214-0.513t0.214-0.533q0.204-0.206 0.52-0.206t0.524 0.208l5.514 5.514q0.141 0.14 0.198 0.297t0.058 0.336-0.058 0.341-0.198 0.3l-5.514 5.514q-0.205 0.207-0.513 0.207t-0.531-0.207q-0.232-0.223-0.228-0.535t0.228-0.534l4.337-4.337z" })
    }
  );
}
function Close() {
  return /* @__PURE__ */ jsx(
    "svg",
    {
      className: "w-5 h-5 fill-current",
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      children: /* @__PURE__ */ jsx("path", { d: "M12 13.054l-5.073 5.073q-0.208 0.207-0.522 0.213t-0.532-0.213-0.217-0.527 0.217-0.527l5.073-5.073-5.073-5.073q-0.207-0.208-0.213-0.522t0.213-0.532 0.527-0.217 0.527 0.217l5.073 5.073 5.073-5.073q0.208-0.207 0.522-0.213t0.532 0.213 0.217 0.527-0.217 0.527l-5.073 5.073 5.073 5.073q0.207 0.208 0.213 0.522t-0.213 0.532-0.527 0.217-0.527-0.217l-5.073-5.073z" })
    }
  );
}
const NAV_ITEMS = [
  {
    label: "Channels",
    href: "/channels"
  }
];
function Sidebar({ isOpen, setIsOpen }) {
  return /* @__PURE__ */ jsx(
    "aside",
    {
      className: `fixed top-0 left-0 z-20 flex h-full p-2 w-2xs transition-transform ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`,
      children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-8 p-4 bg-white rounded-lg shadow-md grow", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-4", children: [
          /* @__PURE__ */ jsx(Logo, {}),
          /* @__PURE__ */ jsx(
            "button",
            {
              className: "flex items-center justify-center w-8 h-8 transition rounded-md cursor-pointer md:hidden text-slate-900 hover:bg-slate-100",
              onClick: () => setIsOpen(false),
              children: /* @__PURE__ */ jsx(Close, {})
            }
          )
        ] }),
        /* @__PURE__ */ jsx("div", { className: "overflow-x-hidden overflow-y-scroll hide-scrollbar", children: /* @__PURE__ */ jsx("ul", { className: "border-t border-slate-200", children: NAV_ITEMS.map((item) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(
          NavLink,
          {
            to: item.href,
            className: ({ isActive }) => isActive ? "flex items-center justify-between px-2 py-4 border-b border-cyan-300" : "flex items-center justify-between px-2 py-4 border-b border-slate-200 group hover:border-cyan-300",
            end: true,
            children: ({ isActive }) => /* @__PURE__ */ jsxs(Fragment, { children: [
              item.label,
              /* @__PURE__ */ jsx(
                "span",
                {
                  className: isActive ? "text-cyan-300" : "text-slate-300 group-hover:text-cyan-300",
                  children: /* @__PURE__ */ jsx(ArrowRight, {})
                }
              )
            ] })
          }
        ) }, item.label)) }) })
      ] })
    }
  );
}
function Popup({
  isOpen,
  setIsOpen,
  buttonRef,
  className,
  children
}) {
  const popupRef = useRef(null);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target) && !(buttonRef.current && buttonRef.current.contains(event.target))) {
        setIsOpen(!isOpen);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, buttonRef]);
  if (!isOpen) return null;
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: ["absolute z-10", className].filter(Boolean).join(" "),
      ref: popupRef,
      children
    }
  );
}
function ProfilePopup() {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const popupButtonRef = useRef(null);
  return /* @__PURE__ */ jsxs("div", { className: "relative", children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        className: "flex items-center justify-center cursor-pointer",
        onClick: () => setIsPopupOpen(!isPopupOpen),
        ref: popupButtonRef,
        children: /* @__PURE__ */ jsx(
          "img",
          {
            className: "w-12 h-12 rounded-full ring-2 ring-cyan-300",
            src: "/user.jpg",
            alt: "avatar"
          }
        )
      }
    ),
    isPopupOpen && /* @__PURE__ */ jsx(
      Popup,
      {
        isOpen: isPopupOpen,
        setIsOpen: setIsPopupOpen,
        buttonRef: popupButtonRef,
        className: "right-0 p-4 mt-2 bg-white rounded-md shadow-sm top-full",
        children: /* @__PURE__ */ jsx("div", { className: "py-2 space-y-1", children: /* @__PURE__ */ jsx(Form, { action: "/logout", method: "POST", children: /* @__PURE__ */ jsx(
          "button",
          {
            type: "submit",
            className: "w-full px-4 py-2 text-sm text-left transition rounded-md text-slate-700 hover:text-white hover:bg-cyan-500/90",
            children: "Logout"
          }
        ) }) })
      }
    )
  ] });
}
function Menu() {
  return /* @__PURE__ */ jsx(
    "svg",
    {
      className: "w-5 h-5 fill-current",
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      children: /* @__PURE__ */ jsx("path", { d: "M4.25 17.634q-0.319 0-0.534-0.216t-0.216-0.534 0.216-0.534 0.534-0.215h15.5q0.319 0 0.534 0.216t0.216 0.535-0.216 0.534-0.534 0.215h-15.5zM4.25 12.75q-0.319 0-0.534-0.216t-0.216-0.534 0.216-0.534 0.534-0.216h15.5q0.319 0 0.534 0.216t0.216 0.534-0.216 0.534-0.534 0.216h-15.5zM4.25 7.865q-0.319 0-0.534-0.216t-0.216-0.535 0.216-0.534 0.534-0.215h15.5q0.319 0 0.534 0.216t0.216 0.534-0.216 0.534-0.534 0.215h-15.5z" })
    }
  );
}
const meta$2 = () => {
  return [{ title: "Channels | Marginality Admin" }];
};
async function loader$2({ request }) {
  const user = await requireUser(request);
  return { user };
}
function ChannelsLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("nav", { className: "flex items-center justify-between gap-6 p-4 md:justify-end", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          className: "flex items-center justify-center w-8 h-8 transition rounded-md cursor-pointer md:hidden text-slate-900 hover:bg-slate-200/80",
          onClick: () => setIsSidebarOpen(true),
          children: /* @__PURE__ */ jsx(Menu, {})
        }
      ),
      /* @__PURE__ */ jsx(ProfilePopup, {})
    ] }),
    /* @__PURE__ */ jsx(Sidebar, { isOpen: isSidebarOpen, setIsOpen: setIsSidebarOpen }),
    /* @__PURE__ */ jsx("main", { className: "py-8 grow md:ml-70 md:py-16", children: /* @__PURE__ */ jsx("div", { className: "px-4 mx-auto max-w-7xl", children: /* @__PURE__ */ jsx(Outlet, {}) }) })
  ] });
}
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ChannelsLayout,
  loader: loader$2,
  meta: meta$2
}, Symbol.toStringTag, { value: "Module" }));
const CodeBlock = ({ code, language }) => {
  const codeRef = useRef(null);
  useEffect(() => {
    const highlightCode = async () => {
      const highlighter = await createHighlighter({
        themes: ["github-light"],
        langs: [language]
      });
      if (codeRef.current) {
        const html = highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: "github-light" }
        });
        const innerContent = html.replace(/<pre[^>]*>/, "").replace(/<\/pre>$/, "");
        codeRef.current.innerHTML = innerContent;
      }
    };
    highlightCode();
  }, [code, language]);
  return /* @__PURE__ */ jsx(
    "pre",
    {
      ref: codeRef,
      className: "p-4 overflow-auto text-sm border rounded-md border-slate-200 not-prose"
    }
  );
};
const SQL_CODE_MEMBERS = `CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  avatar_url TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  location TEXT NOT NULL
);`;
const CSV_CODE_MEMBERS = `id,created_at,avatar_url,name,email,location
14c8afd0-50cc-4aca-9547-c997ed306065,2025-02-21 12:29:21.704945+00,https://i.pravatar.cc/120?img=7,Ethan Reynolds,ethanreynolds@demoemail.com,United States
33a9549c-d436-4f53-ab61-86612c812fda,2025-02-21 12:29:59.907726+00,https://i.pravatar.cc/120?img=52,Eero Virtanen,virtanen@demoemail.com,Finland
4badfc0a-3ec0-4282-833a-6f90604f3e54,2025-02-21 12:28:50.565559+00,https://i.pravatar.cc/120?img=47,Viktoria Melnyk,viktoria@demoemail.com,Ukraine
6af079d1-e63e-499b-84b5-2c94720bdd4a,2025-02-21 12:31:38.60595+00,https://i.pravatar.cc/120?img=14,Elliot Mercer,elliotmercer@demoemail.com,Norway
6e09dac3-e052-4fa6-a57d-eabac73e8b38,2025-02-21 12:30:32.745623+00,https://i.pravatar.cc/120?img=68,Piotr Kaminski,kaminski@demoemail.com,Poland
a2ac4de2-383e-41c8-a1a2-17089c04ace7,2025-02-21 12:27:31.655131+00,https://i.pravatar.cc/120?img=16,Mira Thornton,mira@demoemail.com,Canada
a905829d-2302-4dfd-a758-ff40f25bf97a,2025-02-21 12:28:19.614953+00,https://i.pravatar.cc/120?img=31,Suhyun Park,suhyunpark@demoemail.com,South Korea`;
function Guide() {
  return /* @__PURE__ */ jsxs("article", { className: "w-full max-w-4xl px-4 py-12 mx-auto space-y-8", children: [
    /* @__PURE__ */ jsxs("div", { className: "relative px-8 py-10 space-y-4 border rounded-sm shadow-sm border-cyan-500 bg-cyan-100/20", children: [
      /* @__PURE__ */ jsx("h1", { className: "text-3xl font-semibold text-slate-900 lg:text-4xl", children: "Welcome to Remix Admin Template" }),
      /* @__PURE__ */ jsx("div", { className: "prose prose-slate max-w-none", children: /* @__PURE__ */ jsxs("p", { children: [
        "Before your website is ready, you must complete the steps from the guide below to create, populate, and connect your",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "Supabase" }),
        " database."
      ] }) }),
      /* @__PURE__ */ jsxs("span", { className: "absolute flex w-4 h-4 -top-2 -left-2", children: [
        /* @__PURE__ */ jsx("span", { className: "absolute w-full h-full rounded-full opacity-75 bg-cyan-300 animate-ping" }),
        /* @__PURE__ */ jsx("span", { className: "w-full h-full rounded-full bg-cyan-300" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "px-8 py-10 prose bg-white rounded-md shadow-sm max-w-none prose-slate", children: [
      /* @__PURE__ */ jsx("h2", { children: "Set up Supabase database" }),
      /* @__PURE__ */ jsxs("ol", { children: [
        /* @__PURE__ */ jsxs("li", { children: [
          "Create Supabase account at",
          " ",
          /* @__PURE__ */ jsx("a", { href: "https://supabase.com", children: "Supabase.com" }),
          "."
        ] }),
        /* @__PURE__ */ jsx("li", { children: 'After signing up to your Supabase account, click New project from your dashboard. Select your organization, give the project a name, generate a new password for the database, and select the region  (e.g. "East US (North Virginia)").' })
      ] }),
      /* @__PURE__ */ jsx("h2", { children: "Create the members table" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "Once the database is provisioned, we can create the",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "members" }),
        " table. From your project dashboard, open the SQL editor."
      ] }),
      /* @__PURE__ */ jsx(
        "img",
        {
          src: "/guides/supabase-netlify-sql-editor.png",
          alt: "Create the members and user tables"
        }
      ),
      /* @__PURE__ */ jsx("p", { children: "Run the following commands in the SQL editor to create the members table." }),
      /* @__PURE__ */ jsx(CodeBlock, { code: SQL_CODE_MEMBERS, language: "sql" }),
      /* @__PURE__ */ jsx("h2", { children: "Add data" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "Next, let's add some starter data to the ",
        /* @__PURE__ */ jsx("strong", { children: "members" }),
        " ",
        "table. From the Table Editor in Supabase (1), choose the",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "members" }),
        " table from the list (2) and then select",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "Insert > Import" }),
        " data from CSV (3)."
      ] }),
      /* @__PURE__ */ jsx(
        "img",
        {
          src: "/guides/supabase-netlify-import-csv.png",
          alt: "Create the frameworks table"
        }
      ),
      /* @__PURE__ */ jsx("p", { children: "Paste the following data:" }),
      /* @__PURE__ */ jsx(CodeBlock, { code: CSV_CODE_MEMBERS, language: "csv" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "This will give you a preview of the data that will be inserted into the database. Click ",
        /* @__PURE__ */ jsx("strong", { children: "Import data" }),
        " to add the data to the database."
      ] }),
      /* @__PURE__ */ jsx("h2", { children: "Configure the Supabase Netlify extension" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "The",
        " ",
        /* @__PURE__ */ jsx("a", { href: "https://app.netlify.com/extensions/supabase", children: "Supabase Netlify extension" }),
        " ",
        "should already be installed. Visit your site's configuration page and scroll to the Supabase section. Click ",
        /* @__PURE__ */ jsx("strong", { children: "Connect" }),
        " to connect your Netlify site to your Supabase account using OAuth."
      ] }),
      /* @__PURE__ */ jsx(
        "img",
        {
          src: "/guides/supabase-netlify-connect-oauth.png",
          alt: "Configure the Supabase extension"
        }
      ),
      /* @__PURE__ */ jsxs("p", { children: [
        "Once you've completed this process, return to the Supabase section of your site configuration, and choose the project you just created in Supabase. Make sure to choose ",
        /* @__PURE__ */ jsx("strong", { children: "Other" }),
        ' in the "Where will you use Supabase?" dropdown field.'
      ] }),
      /* @__PURE__ */ jsx(
        "img",
        {
          src: "/guides/supabase-netlify-extension-configuration.png",
          alt: "Supabase Netlify extension configuration"
        }
      ),
      /* @__PURE__ */ jsx("h2", { children: "Deploy the site again" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "Now that the extension is configured, we can deploy the site again. Got to ",
        /* @__PURE__ */ jsx("strong", { children: "Deploys" }),
        " (1) and click the",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "Deploy site" }),
        " (2) button to deploy the site."
      ] }),
      /* @__PURE__ */ jsx(
        "img",
        {
          src: "/guides/deploy-button.png",
          alt: "Supabase Netlify extension configuration"
        }
      ),
      /* @__PURE__ */ jsx("p", { children: "Once the build is complete, navigate to your production URL, and you should see the login form." }),
      /* @__PURE__ */ jsx("img", { src: "/guides/remix-login.png", alt: "Template login form" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "Next, add an authenticated user to log in to the template. In your Supabase project, navigate to ",
        /* @__PURE__ */ jsx("strong", { children: "Authentication" }),
        " (1), choose ",
        /* @__PURE__ */ jsx("strong", { children: "Add user" }),
        " (2), and provide an email and password (Email: demo@example.com, Password: demo123)."
      ] }),
      /* @__PURE__ */ jsx("img", { src: "/guides/remix-supabase-add-user.png", alt: "Add user to Supabase" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "Once you've completed this process, return to the login form and log in to the template. You should see the ",
        /* @__PURE__ */ jsx("strong", { children: "members" }),
        " that we just added to the database."
      ] }),
      /* @__PURE__ */ jsx("img", { src: "/guides/remix-dashboard.png", alt: "Template with data" })
    ] })
  ] });
}
async function loader$1() {
  let isSupabaseAvailable = true;
  try {
    getSupabaseClient$1();
  } catch (error) {
    isSupabaseAvailable = false;
  }
  if (isSupabaseAvailable) {
    return redirect("/login");
  }
  return Response.json({});
}
const meta$1 = () => {
  return [
    { title: "New Remix App" },
    { name: "description", content: "Welcome to Remix!" }
  ];
};
function Index() {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("nav", { className: "flex justify-center w-full px-4 pt-8", children: /* @__PURE__ */ jsx(Logo, {}) }),
    /* @__PURE__ */ jsx("main", { className: "grow", children: /* @__PURE__ */ jsx(Guide, {}) }),
    /* @__PURE__ */ jsx("footer", { className: "w-full px-4 pb-8 mx-auto max-w-7xl", children: /* @__PURE__ */ jsxs("p", { className: "text-sm text-center", children: [
      "© ",
      (/* @__PURE__ */ new Date()).getFullYear(),
      " Netlify. All rights reserved."
    ] }) })
  ] });
}
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Index,
  loader: loader$1,
  meta: meta$1
}, Symbol.toStringTag, { value: "Module" }));
async function action$1({ request }) {
  const response = redirect("/login");
  return clearSession(response);
}
function Logout() {
  return /* @__PURE__ */ jsx(Form, { method: "POST", children: /* @__PURE__ */ jsx("button", { type: "submit", className: "text-sm underline text-cyan-600", children: "Logout" }) });
}
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1,
  default: Logout
}, Symbol.toStringTag, { value: "Module" }));
const getSupabaseClient = void 0;
const meta = () => {
  return [{ title: "Login | Marginality Admin" }];
};
async function loader({ request }) {
  const user = await getSessionUser(request);
  if (user) {
    return redirect("/channels");
  }
  return null;
}
async function action({ request }) {
  const formData = await request.formData();
  const accessToken = formData.get("access_token");
  const refreshToken = formData.get("refresh_token");
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    return Response.json(
      { error: "Authentication failed" },
      { status: 400 }
    );
  }
  const { getSupabaseClient: getSupabaseClient2 } = await Promise.resolve().then(() => getSupabaseClient$2);
  const supabase = getSupabaseClient2();
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) {
    return Response.json(
      { error: "Invalid token" },
      { status: 401 }
    );
  }
  const { getSession: getSession2, commitSession: commitSession2 } = await Promise.resolve().then(() => session_server);
  const session = await getSession2();
  session.set("access_token", accessToken);
  session.set("refresh_token", refreshToken);
  return redirect("/channels", {
    headers: {
      "Set-Cookie": await commitSession2(session)
    }
  });
}
function LoginForm() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";
  const [clientError, setClientError] = useState(null);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setClientError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;
      if (data.session) {
        const tokenFormData = new FormData();
        tokenFormData.set("access_token", data.session.access_token);
        tokenFormData.set("refresh_token", data.session.refresh_token);
        submit(tokenFormData, { method: "POST" });
      }
    } catch (error) {
      setClientError(error.message || "Login failed");
    }
  };
  return /* @__PURE__ */ jsxs(Form, { method: "POST", onSubmit: handleSubmit, children: [
    ((actionData == null ? void 0 : actionData.error) || clientError) && /* @__PURE__ */ jsx("p", { className: "p-3 mb-4 text-sm rounded-md bg-rose-50 text-rose-700", children: (actionData == null ? void 0 : actionData.error) || clientError }),
    /* @__PURE__ */ jsxs(
      "fieldset",
      {
        className: "w-full space-y-4 disabled:opacity-70",
        disabled: isSubmitting,
        children: [
          /* @__PURE__ */ jsx(
            TextField,
            {
              id: "email",
              name: "email",
              label: "Email address",
              required: true,
              type: "email",
              placeholder: "Email address"
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              id: "password",
              name: "password",
              label: "Password",
              required: true,
              type: "password",
              placeholder: "Password"
            }
          ),
          /* @__PURE__ */ jsx(Button, { type: "submit", className: "w-full", loading: isSubmitting, children: "Login" })
        ]
      }
    )
  ] });
}
function Login() {
  return /* @__PURE__ */ jsx("div", { className: "flex items-center justify-center min-h-screen px-4", children: /* @__PURE__ */ jsxs("div", { className: "w-full max-w-md p-8 space-y-8 bg-white shadow-md rounded-xl", children: [
    /* @__PURE__ */ jsx("div", { className: "space-y-3", children: /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold text-slate-900 sm:text-3xl", children: "Log In to Marginality Admin" }) }),
    /* @__PURE__ */ jsx(LoginForm, {})
  ] }) });
}
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action,
  default: Login,
  loader,
  meta
}, Symbol.toStringTag, { value: "Module" }));
function PrivateNotFound() {
  return /* @__PURE__ */ jsx("main", { className: "grow px-8 py-12 flex items-center justify-center", children: /* @__PURE__ */ jsxs("div", { className: "px-8 py-10 space-y-4 border rounded-sm shadow-sm border-cyan-500 bg-cyan-100/20 w-full max-w-4xl text-center", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold text-slate-900 sm:text-3xl lg:text-4xl", children: "Page Not Found" }),
    /* @__PURE__ */ jsx("p", { children: "The page you’re looking for doesn’t exist." }),
    /* @__PURE__ */ jsx(Link, { to: "/", className: "underline text-cyan-600", children: "Go back home" })
  ] }) });
}
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: PrivateNotFound
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-Dxh-np94.js", "imports": ["/assets/components-RfMRA6_q.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/root-7Dji4Nop.js", "imports": ["/assets/components-RfMRA6_q.js"], "css": [] }, "routes/channels._index": { "id": "routes/channels._index", "parentId": "routes/channels", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/channels._index-BIsdQyE1.js", "imports": ["/assets/components-RfMRA6_q.js", "/assets/Button-Koz2znhj.js"], "css": [] }, "routes/channels.$id": { "id": "routes/channels.$id", "parentId": "routes/channels", "path": ":id", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/channels._id-UIjD4t40.js", "imports": ["/assets/components-RfMRA6_q.js", "/assets/Button-Koz2znhj.js"], "css": [] }, "routes/channels.new": { "id": "routes/channels.new", "parentId": "routes/channels", "path": "new", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/channels.new-IKHFEcT2.js", "imports": ["/assets/components-RfMRA6_q.js", "/assets/Button-Koz2znhj.js", "/assets/TextField-DTsKUFbT.js"], "css": [] }, "routes/channels": { "id": "routes/channels", "parentId": "root", "path": "channels", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/channels-BS3zbXmR.js", "imports": ["/assets/components-RfMRA6_q.js", "/assets/Logo-rFq4Y6D1.js"], "css": [] }, "routes/_index": { "id": "routes/_index", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/_index-Dt6SPIFb.js", "imports": ["/assets/components-RfMRA6_q.js", "/assets/Logo-rFq4Y6D1.js"], "css": [] }, "routes/logout": { "id": "routes/logout", "parentId": "root", "path": "logout", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/logout-RROvDquy.js", "imports": ["/assets/components-RfMRA6_q.js"], "css": [] }, "routes/login": { "id": "routes/login", "parentId": "root", "path": "login", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/login-D3FauZWw.js", "imports": ["/assets/components-RfMRA6_q.js", "/assets/Button-Koz2znhj.js", "/assets/TextField-DTsKUFbT.js"], "css": [] }, "routes/$": { "id": "routes/$", "parentId": "root", "path": "*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/_-7MrBgNaC.js", "imports": ["/assets/components-RfMRA6_q.js"], "css": [] } }, "url": "/assets/manifest-dbfc30b9.js", "version": "dbfc30b9" };
const mode = "production";
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "v3_fetcherPersist": true, "v3_relativeSplatPath": true, "v3_throwAbortReason": true, "v3_routeConfig": false, "v3_singleFetch": true, "v3_lazyRouteDiscovery": true, "unstable_optimizeDeps": false };
const isSpaMode = false;
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/channels._index": {
    id: "routes/channels._index",
    parentId: "routes/channels",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route1
  },
  "routes/channels.$id": {
    id: "routes/channels.$id",
    parentId: "routes/channels",
    path: ":id",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/channels.new": {
    id: "routes/channels.new",
    parentId: "routes/channels",
    path: "new",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/channels": {
    id: "routes/channels",
    parentId: "root",
    path: "channels",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route5
  },
  "routes/logout": {
    id: "routes/logout",
    parentId: "root",
    path: "logout",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/login": {
    id: "routes/login",
    parentId: "root",
    path: "login",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "routes/$": {
    id: "routes/$",
    parentId: "root",
    path: "*",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  }
};
const build = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  assets: serverManifest,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  mode,
  publicPath,
  routes
}, Symbol.toStringTag, { value: "Module" }));
export {
  assetsBuildDirectory as a,
  build as b,
  basename as c,
  entry as e,
  future as f,
  isSpaMode as i,
  mode as m,
  publicPath as p,
  routes as r,
  serverManifest as s
};
