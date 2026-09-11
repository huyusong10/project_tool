/** A project revision may change while this work's execution and forecast facts stay identical. */
export function withoutForecastRevision<T extends object>(item: T) {
  const value = item as T & {deliveryForecast?: {revision:number}};
  return value.deliveryForecast ? {...item, deliveryForecast:{...value.deliveryForecast,revision:0}} : item;
}
