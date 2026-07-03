type AccessOptions = {
  route: string;
  requireSecretInProduction?: boolean;
};

export async function requireBackendAccess(req: Request, options: AccessOptions) {
  const secret = readEnv("BOWIE_API_SECRET");
  if (!secret) {
    if (options.requireSecretInProduction && process.env.NODE_ENV === "production") {
      return Response.json(
        { error: `BOWIE_API_SECRET is required before ${options.route} can run in production.` },
        { status: 500 }
      );
    }

    return null;
  }

  const supplied = getBearerToken(req) ?? req.headers.get("x-bowie-api-secret") ?? "";
  if (!constantTimeEqual(supplied, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function constantTimeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
