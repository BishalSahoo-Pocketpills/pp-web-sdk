export function createGetQueryParam(): (url: string, findParam: string) => string {
  return function getQueryParam(url: string, findParam: string): string {
    try {
      if (!findParam || !url) return '';

      const urlSplit = url.split('?');
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
      return decodeURIComponent(params[param]);
    } catch (e) {
      return '';
    }
  };
}
