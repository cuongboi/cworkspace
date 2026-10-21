import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MAX_ROWS = 2000;

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

export function CsvTable({ text, tsv }: { text: string; tsv: boolean }) {
  const { t } = useTranslation();
  const rows = parseDelimited(text.replace(/^\uFEFF/, ""), tsv ? "\t" : ",");
  if (rows.length === 0)
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {t("common.documentViewer.empty")}
      </p>
    );
  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_ROWS);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 bg-muted">
            <TableRow>
              {header.map((cell, i) => (
                <TableHead key={i}>{cell}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((cells, r) => (
              <TableRow key={r}>
                {header.map((_, c) => (
                  <TableCell key={c} className="max-w-80 truncate">
                    {cells[c] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {body.length > MAX_ROWS ? (
        <p className="text-xs text-muted-foreground">
          {t("common.documentViewer.rowsTruncated", {
            shown: MAX_ROWS,
            total: body.length,
          })}
        </p>
      ) : null}
    </div>
  );
}
