
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const supabaseResponse = NextResponse.next({
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
  // Inscription/connexion par téléphone publiques, les données restent protégées par FastAPI.
  const publicCollabEntry = pathname === "/collaboratif/rejoindre" || pathname === "/collaboratif/connexion";

  // Routes privées nécessitant une connexion
  const protectedRoutes = [
    "/chat",
    "/conversations",
    "/credits",
    "/settings",
    "/collaboratif",
    "/assistant",
  ];

  const isProtectedRoute = protectedRoutes.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(`${route}/`),
  );

  // Utilisateur non connecté → page de connexion
  if (!user && isProtectedRoute && !publicCollabEntry) {
    return NextResponse.redirect(
      new URL("/login", request.url),
    );
  }

  // Utilisateur déjà connecté → chat
  if (
    user &&
    (pathname === "/login" || pathname === "/register")
  ) {
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
    "/settings/:path*",
    "/collaboratif/:path*",
    "/assistant/:path*",
  ],
};
