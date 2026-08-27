import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Check, Package, Plus, Search } from 'lucide-react';
import clsx from 'clsx';

import { api } from '../lib/api';

/**
 * FG picker.
 *
 * Two ways to name what is being produced, matching the data: an FG from the
 * master list, or free text like "TESLA ABD" or "Daimler B-Säule". Free text is
 * a first-class path, not a fallback - it is common in the sheets.
 *
 * Typing something that looks like an FG the master list does not have offers to
 * register it, so the number joins the master rather than becoming loose text.
 */
export default function FgCombobox({ value, onChange, autoFocus }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const products = useQuery({
    queryKey: ['production', 'products', debounced],
    queryFn: () => api.searchProducts(debounced),
    staleTime: 60 * 1000
  });

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
          <span className="truncate text-[14px] font-semibold text-gray-900">{selectedLabel}</span>
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
            {products.isFetching && (
              <div className="px-2 py-3 text-[13px] text-gray-400">Searching…</div>
            )}

            {results.map((product) => (
              <Command.Item
                key={product.id}
                value={String(product.id)}
                onSelect={() =>
                  onChange({ productId: product.id, fgNumber: product.fg_number, customProductName: null })
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
                    customProductName: null
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
                  onChange({ productId: null, fgNumber: null, customProductName: query.trim() })
                }
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] data-[selected=true]:bg-gray-100"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="text-gray-700">
                  Use <span className="font-medium text-gray-900">{query.trim()}</span> as a custom product
                </span>
              </Command.Item>
            )}

            {!query.trim() && !results.length && !products.isFetching && (
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
