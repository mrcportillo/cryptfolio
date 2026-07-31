import assert from "node:assert/strict";
import test from "node:test";
import { Auth0Provider, useUser } from "@auth0/nextjs-auth0/client";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AUTH0_PROFILE_ROUTE } from "../src/lib/auth-routes.ts";

function NavbarAuthState() {
  const { user } = useUser({ route: AUTH0_PROFILE_ROUTE });
  return React.createElement("span", null, user?.name ?? "Login");
}

test("navbar reads the server-provided user from the configured profile route", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      Auth0Provider,
      {
        user: { sub: "auth0|navbar-test", name: "Navbar Test User" },
        profileRoute: AUTH0_PROFILE_ROUTE,
      },
      React.createElement(NavbarAuthState),
    ),
  );

  assert.equal(markup, "<span>Navbar Test User</span>");
});
