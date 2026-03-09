export function createGetQueryParam(): (url: string, findParam: string) => string {
  return function getQueryParam(url: string, findParam: string): string {
    try {
      if (!findParam || !url) return '';

      // Strip fragment before parsing to prevent #hash leaking into param values
      const defragmented = url.split('#')[0];
      const urlSplit = defragmented.split('?');
      const queryParams = urlSplit.length > 1 ? '?' + urlSplit[1] : urlSplit[0];
      const urlSearchParams = new URLSearchParams(queryParams);
      const params: Record<string, string> = {};
      urlSearchParams.forEach(function(value: string, key: string) {
        params[key] = value;
      });

      const param = Object.keys(params).find(function(key: string) {
        return key.toLowerCase() === findParam.toLowerCase();
      });

      if (!param) return '';
      return params[param];
    } catch (e) {
      return '';
    }
  };
}
