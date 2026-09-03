import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Check, Factory, Package, Plus, Search } from 'lucide-react';
import clsx from 'clsx';

import { api } from '../lib/api';

/**
 * FG picker.
 *
 * Three ways to name what is being produced, matching the data: an open project
 * from SAP, an FG from our own master list, or free text like "TESLA ABD".
 * Free text is a first-class path, not a fallback - it is common in the sheets.
 *
 * The SAP projects are fetched once and filtered here in the browser rather than
 * searched on the server. There are around 46 open at a time, a few kilobytes
 * altogether, so this filters as fast as someone types; going back to SAP per
 * keystroke would put a quarter-second of tunnel latency between each letter and
 * the list, which is slower, not fresher.
 */

export default function FgCombobox({ value, onChange, autoFocus }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const products = useQuery({
    queryKey: ['production', 'products', debounced],
    queryFn: () => api.searchProducts(debounced),
    staleTime: 60 * 1000
  });

  // One request for the whole list; the filtering below is local.
  const sap = useQuery({
    queryKey: ['sap', 'projects'],
    queryFn: () => api.sapProjects(),
    staleTime: 5 * 60 * 1000
  });

  const term = query.trim().toLowerCase();
  // The whole list, always - a preview of the first few made it look as though
  // SAP held only that many projects. The list scrolls; the count above it says
  // how many there really are.
  const sapMatches = useMemo(() => {
    const all = sap.data?.projects || [];
    if (!term) return all;
    return all.filter((project) =>
      project.itemCode.toLowerCase().includes(term)
      || String(project.description || '').toLowerCase().includes(term)
    );
  }, [sap.data, term]);

  /**
   * Take a SAP project as this card's product.
   *
   * The card keeps the shape it already has - it points at a row in our own FG
   * master - and gains the SAP order number alongside. The FG number is the key
   * both sides already agree on, so an FG we have never planned before is
   * registered here rather than becoming loose text.
   */
  const chooseSapProject = async (project) => {
    setResolving(true);
    try {
      const known = await api.searchProducts(project.itemCode);
      const match = (known || []).find(
        (p) => p.fg_number.toLowerCase() === project.itemCode.toLowerCase()
      );
      const product = match || await api.createProduct(project.itemCode, project.description || '');

      onChange({
        productId: product.id,
        fgNumber: product.fg_number,
        customProductName: null,
        description: product.description || project.description || '',
        sapOrderEntry: project.absoluteEntry,
        projectType: project.projectType,
        sapRemainingQty: project.remainingQty
      });
    } finally {
      setResolving(false);
    }
  };

  const looksLikeFg = /^FG\d+/i.test(query.trim());
  const results = products.data || [];
  const exactMatch = results.some((p) => p.fg_number.toLowerCase() === query.trim().toLowerCase());

  const selectedLabel = value?.productId
    ? value.fgNumber
    : value?.customProductName || null;

  return (
    <div className="overflow-hidden rounded-md border border-gray-300">
      {selectedLabel && (
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-etilog-light px-3 py-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold text-gray-900">{selectedLabel}</span>
            {value?.sapOrderEntry && (
              <span className="shrink-0 text-[11px] font-medium text-gray-500">
                {value.projectType || 'SAP'}
                {value.sapRemainingQty != null && ` · ${value.sapRemainingQty} left on the order`}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-[12px] font-medium text-etilog hover:underline"
          >
            Change
          </button>
        </div>
      )}

      {!selectedLabel && (
        <Command shouldFilter={false} className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            <Command.Input
              autoFocus={autoFocus}
              value={query}
              onValueChange={setQuery}
              placeholder="FG number, or type a product name"
              className="w-full bg-transparent py-2.5 text-[14px] outline-none placeholder:text-gray-400"
            />
          </div>

          <Command.List className="h-52 overflow-y-auto p-1">
            {(products.isFetching || resolving) && (
              <div className="px-2 py-3 text-[13px] text-gray-400">
                {resolving ? 'Opening the project…' : 'Searching…'}
              </div>
            )}

            {/* Open SAP projects first: this is what the plan is actually made
                of, and picking one brings the material check with it. */}
            {sapMatches.length > 0 && (
              <>
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Open projects in SAP ({sapMatches.length})
                </div>
                {sapMatches.map((project) => (
                  <Command.Item
                    key={`sap-${project.absoluteEntry}`}
                    value={`sap-${project.absoluteEntry}`}
                    onSelect={() => chooseSapProject(project)}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] data-[selected=true]:bg-gray-100"
                  >
                    <Factory className="h-3.5 w-3.5 shrink-0 text-etilog" aria-hidden="true" />
                    <span className="font-medium text-gray-900">{project.itemCode}</span>
                    {project.projectType && (
                      <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-500">
                        {project.projectType}
                      </span>
                    )}
                    <span className="truncate text-[13px] text-gray-500">{project.description}</span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-400">
                      {project.remainingQty} left
                    </span>
                  </Command.Item>
                ))}
                {results.length > 0 && (
                  <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Our FG list
                  </div>
                )}
              </>
            )}

            {results.map((product) => (
              <Command.Item
                key={product.id}
                value={String(product.id)}
                onSelect={() =>
                  onChange({
                    productId: product.id,
                    fgNumber: product.fg_number,
                    customProductName: null,
                    description: product.description || ''
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] data-[selected=true]:bg-gray-100"
              >
                <Package className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="font-medium text-gray-900">{product.fg_number}</span>
                <span className="truncate text-[13px] text-gray-500">{product.description}</span>
              </Command.Item>
            ))}

            {/* An FG the master list does not know yet */}
            {looksLikeFg && !exactMatch && !products.isFetching && (
              <Command.Item
                value="__register"
                onSelect={async () => {
                  const created = await api.createProduct(query.trim().toUpperCase());
                  onChange({
                    productId: created.id,
                    fgNumber: created.fg_number,
                    customProductName: null,
                    description: created.description || ''
                  });
                }}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] data-[selected=true]:bg-gray-100"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-etilog" aria-hidden="true" />
                <span className="text-gray-700">
                  Add <span className="font-medium text-gray-900">{query.trim().toUpperCase()}</span> to the FG list
                </span>
              </Command.Item>
            )}

            {/* Free text, for non-SAP production */}
            {query.trim() && !looksLikeFg && (
              <Command.Item
                value="__custom"
                onSelect={() =>
                  onChange({
                    productId: null, fgNumber: null, customProductName: query.trim(), description: ''
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] data-[selected=true]:bg-gray-100"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="text-gray-700">
                  Use <span className="font-medium text-gray-900">{query.trim()}</span> as a custom product
                </span>
              </Command.Item>
            )}

            {!query.trim() && !results.length && !sapMatches.length && !products.isFetching && (
              <div className={clsx('px-2 py-3 text-[13px] text-gray-400')}>
                Start typing an FG number, or any product name.
              </div>
            )}
          </Command.List>
        </Command>
      )}
    </div>
  );
}
