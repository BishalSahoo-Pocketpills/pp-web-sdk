export interface EventSourcePlatforms {
  mixpanel: { enabled: boolean };
  gtm: { enabled: boolean };
}

export interface EventSourceConfig {
  attribute: string;
  categoryAttribute: string;
  labelAttribute: string;
  valueAttribute: string;
  debounceMs: number;
  platforms: EventSourcePlatforms;
  gtmEventName: string;
  mixpanelEventName: string;
  includePageContext: boolean;
}

export interface EventSourceData {
  event_source: string;
  element_tag: string;
  element_text: string;
  element_href?: string;
  event_category?: string;
  event_label?: string;
  event_value?: string;
  page_url?: string;
  page_path?: string;
  page_title?: string;
  timestamp: string;
  interaction_type?: string;
  [key: string]: string | undefined;
}

export interface EventSourceAPI {
  configure: (options?: Partial<EventSourceConfig>) => EventSourceConfig;
  init: () => void;
  trackElement: (element: Element) => void;
  trackCustom: (eventSource: string, properties?: Record<string, any>) => void;
  getConfig: () => EventSourceConfig;
}
