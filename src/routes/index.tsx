import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { prepareArtwork } from "@/lib/prepress.functions";
import { CAVA_293X237 } from "@/prepress/core/template-config";
import type { PrepressResponse } from "@/prepress/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
// --- optional SleeveManager Validation V2 UI (removable) ---
import type { V2CheckStatus } from "@/prepress/validation2/sleevemanager-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shrink sleeve drukklaar maken | Prepress POC" },
      {
        name: "description",
        content:
          "Upload artwork-PDF's en genereer automatisch drukklare shrink sleeve PDF's met behoud van lagen, dekwit en overprint.",
      },
      { property: "og:title", content: "Shrink sleeve drukklaar maken | Prepress POC" },
      {
        property: "og:description",
        content: "Automatisch drukklare shrink sleeve PDF's zonder Illustrator of Acrobat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Bestand kon niet worden gelezen"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function StatusPill({ status }: { status: "PASS" | "FAIL" }) {
  return (
    <Badge variant={status === "PASS" ? "default" : "destructive"} className="font-mono text-[11px]">
      {status}
    </Badge>
  );
}

/** Validation 2 only — experimental, non-blocking. */
function V2Pill({ status }: { status: V2CheckStatus | "PASS" | "WARNING" | "FAIL" }) {
  const label = status === "NOT_VERIFIABLE" ? "NIET VAST TE STELLEN" : status;
  const className =
    status === "PASS"
      ? "border-transparent bg-emerald-600 text-white"
      : status === "FAIL"
        ? "border-transparent bg-destructive text-destructive-foreground"
        : status === "WARNING"
          ? "border-transparent bg-amber-500 text-black"
          : "border-dashed border-muted-foreground/60 bg-muted text-muted-foreground";
  return <Badge className={`font-mono text-[11px] ${className}`}>{label}</Badge>;
}

function Index() {
  const run = useServerFn(prepareArtwork);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepressResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const artworkBase64 = await fileToBase64(file);
      const response = await run({
        data: { templateId: CAVA_293X237.id, filename: file.name, artworkBase64 },
      });
      setResult(response as PrepressResponse);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Onbekende fout tijdens verwerking");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Prepress POC
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Shrink sleeve drukklaar maken</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Upload een artwork-PDF op sleeveformaat. Het artwork wordt 1:1 in de bestaande artworklaag
          van de master geplaatst, met behoud van stans, maten, dekwit en overprint. Er wordt niets
          geschaald en niets gerasterd.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Artwork uploaden</CardTitle>
          <CardDescription>
            Template: {CAVA_293X237.name} — verwacht formaat 830,551 × 671,811 pt (293 × 237 mm), 1 pagina.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="file"
            accept="application/pdf"
            aria-label="Artwork PDF"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
            }}
            className="block w-full cursor-pointer rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:text-secondary-foreground"
          />
          <div className="flex items-center gap-3">
            <Button onClick={onSubmit} disabled={!file || busy}>
              {busy ? "Bezig met verwerken…" : "Drukklaar maken"}
            </Button>
            {file ? (
              <span className="text-sm text-muted-foreground">
                {file.name} ({Math.round(file.size / 1024)} kB)
              </span>
            ) : null}
          </div>
          {message ? <p className="text-sm text-destructive">{message}</p> : null}
        </CardContent>
      </Card>

      {result ? (
        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>2. Validatierapport</CardTitle>
                <CardDescription>
                  Template {result.templateId} — {result.checks.length} controles uitgevoerd
                </CardDescription>
              </div>
              <StatusPill status={result.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="divide-y divide-border">
              {result.checks.map((check) => (
                <li key={check.key} className="flex items-start justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{check.label}</p>
                    {check.detail ? (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{check.detail}</p>
                    ) : null}
                  </div>
                  <StatusPill status={check.status} />
                </li>
              ))}
            </ul>

            {result.errors.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
                <p className="mb-2 text-sm font-medium">Technische fouten</p>
                <ul className="space-y-1">
                  {result.errors.map((error) => (
                    <li key={error.code + error.message} className="text-sm text-muted-foreground">
                      <span className="font-mono text-xs">{error.code}</span> — {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.status === "PASS" && result.downloadUrl ? (
              <>
                <Separator />
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild>
                    <a href={result.downloadUrl} download={result.outputFilename}>
                      Download {result.outputFilename}
                    </a>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Tijdelijke, privé link — geldig{" "}
                    {Math.round((result.downloadExpiresInSeconds ?? 0) / 60)} minuten.
                  </span>
                </div>
              </>
            ) : null}

            <details className="rounded-md border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">Technisch logboek</summary>
              <ul className="mt-3 space-y-1">
                {result.logs.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="font-mono text-xs text-muted-foreground">
                    {entry.at} · {entry.event}
                    {entry.data ? ` · ${JSON.stringify(entry.data)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {result?.validation2?.enabled ? (
        <Card className="mt-8 border-dashed">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Validatie 2 – SleeveManager</CardTitle>
                <CardDescription>
                  {result.validation2.name} — experimenteel, niet blokkerend. Alleen inspectie, geen
                  correcties. De download blijft beschikbaar zolang validatie 1 PASS is.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px]">
                  Experimenteel – niet blokkerend
                </Badge>
                <V2Pill status={result.validation2.status} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y divide-border">
              {result.validation2.checks.map((check) => (
                <li key={check.key} className="flex items-start justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {check.key}
                      {check.detail ? ` · ${check.detail}` : ""}
                    </p>
                  </div>
                  <V2Pill status={check.status} />
                </li>
              ))}
            </ul>

            <div className="rounded-md border border-border p-4 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Complexiteit (informatief)</p>
              <p className="font-mono">
                score {result.validation2.complexity.pdfComplexityScore} · {result.validation2.complexity.fileSizeMb} MB ·
                pathSegments {result.validation2.complexity.pathSegments} · images{" "}
                {result.validation2.complexity.imageXObjects} · forms{" "}
                {result.validation2.complexity.formXObjects}
              </p>
              <p className="mt-2">{result.validation2.complexity.note}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
