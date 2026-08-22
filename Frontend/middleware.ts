import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Routes qui nécessitent une connexion
  const protectedRoutes = [
    "/chat",
    "/conversations",
    "/credits",
    "/packs",
    "/settings",
  ];

  const isProtectedRoute = protectedRoutes.some(
    (route) =>
      pathname === route || pathname.startsWith(`${route}/`),
  );

  // Utilisateur non connecté → login
  if (!user && isProtectedRoute) {
    return NextResponse.redirect(
      new URL("/login", request.url),
    );
  }

  // Utilisateur déjà connecté → chat
  if (user && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(
      new URL("/chat", request.url),
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/login",
    "/register",
    "/chat/:path*",
    "/conversations/:path*",
    "/credits/:path*",
    "/packs/:path*",
    "/settings/:path*",
  ],
};