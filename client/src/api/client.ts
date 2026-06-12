import type {
  Shelter,
  Resource,
  CrisisAlert,
  Volunteer,
  OutreachPopup,
  LegalHelpFlow,
  ImpactMetrics,
  TransitEta,
  OutreachAuthUser,
} from '../types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

// Custom error class for API errors
export class APIError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Type-safe JSON parsing with error handling
 */
async function parseJSON<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new APIError(
      response.status,
      response.statusText,
      `Failed to parse response: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

/**
 * Core request handler with comprehensive error handling
 */
async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const message = errorText || response.statusText || `HTTP ${response.status}`;
      throw new APIError(response.status, response.statusText, message);
    }

    return await parseJSON<T>(response);
  } catch (error) {
    // Re-throw API errors as-is
    if (error instanceof APIError) {
      throw error;
    }
    // Wrap other errors
    if (error instanceof TypeError) {
      throw new APIError(0, 'NetworkError', `Network error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Helper to safely encode query parameters
 */
function buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const filtered = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
  const qs = new URLSearchParams(
    Object.entries(filtered).map(([k, v]) => [k, String(v)])
  ).toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  getShelters: (params?: Record<string, string>): Promise<Shelter[]> => {
    const qs = buildQueryString(params);
    return request<Shelter[]>(`/shelters${qs}`);
  },

  getResources: (params?: Record<string, string>): Promise<Resource[]> => {
    const qs = buildQueryString(params);
    return request<Resource[]>(`/resources${qs}`);
  },

  getLiveResources: (): Promise<{ resources: Resource[]; popups: OutreachPopup[] }> =>
    request<{ resources: Resource[]; popups: OutreachPopup[] }>('/resources/live'),

  getRecommendedShelters: (params: {
    lat: number;
    lng: number;
    tags?: string[];
  }): Promise<Shelter[]> => {
    const qs = buildQueryString({
      lat: params.lat,
      lng: params.lng,
      ...(params.tags?.length && { tags: params.tags.join(',') }),
    });
    return request<Shelter[]>(`/shelters/recommendations${qs}`);
  },

  getAlerts: (): Promise<CrisisAlert[]> => request<CrisisAlert[]>('/alerts'),

  registerVolunteer: (data: Volunteer): Promise<{ id: string }> =>
    request<{ id: string }>('/volunteers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  rateShelter: (id: string, rating: number): Promise<void> =>
    request<void>(`/shelters/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }),

  submitShelterFeedback: (
    id: string,
    data: {
      feltSafe: boolean;
      womenSafetyScore: number;
      lgbtqSafetyScore: number;
      antiRacismScore: number;
      comment?: string;
    }
  ): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/shelters/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  submitShelterCheckin: (id: string, helped: boolean, notes?: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/shelters/${id}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ helped, notes }),
    }),

  submitResourceCheckin: (id: string, helped: boolean, notes?: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/resources/${id}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ helped, notes }),
    }),

  getLegalFlow: (issue: string, city = 'National'): Promise<LegalHelpFlow> =>
    request<LegalHelpFlow>(
      `/legal/flow?issue=${encodeURIComponent(issue)}&city=${encodeURIComponent(city)}`
    ),

  updateResourceLiveStatus: (
    id: string,
    token: string,
    data: {
      status: 'open' | 'limited' | 'full' | 'closed';
      essentials: { food: boolean; shower: boolean; restroom: boolean; charging: boolean; laundry: boolean };
      closesAt?: string;
      note?: string;
      verifier?: string;
    }
  ): Promise<{ ok: boolean; updatedAt: string }> =>
    request<{ ok: boolean; updatedAt: string }>(`/resources/${id}/live-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    }),

  createOutreachPopup: (
    token: string,
    data: {
      title: string;
      type: string;
      city: string;
      address: string;
      lat: number;
      lng: number;
      startsAt: string;
      endsAt: string;
      services: string[];
      verifier?: string;
    }
  ): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>('/resources/popups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    }),

  loginOutreach: (email: string, password: string): Promise<{ token: string; user: OutreachAuthUser }> =>
    request<{ token: string; user: OutreachAuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  registerOutreach: (
    email: string,
    password: string,
    name: string,
    invite: string,
    role: 'outreach' | 'admin' = 'outreach'
  ): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>('/auth/register-outreach', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, invite, role }),
    }),

  me: (token: string): Promise<{ user: OutreachAuthUser }> =>
    request<{ user: OutreachAuthUser }>('/auth/me', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }),

  getTransitEta: (params: {
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
    safeRoute?: boolean;
  }): Promise<TransitEta> => {
    const qs = buildQueryString({
      fromLat: params.fromLat,
      fromLng: params.fromLng,
      toLat: params.toLat,
      toLng: params.toLng,
      safeRoute: Boolean(params.safeRoute),
    });
    return request<TransitEta>(`/transit/eta${qs}`);
  },

  trackEvent: (eventType: string, metadata?: Record<string, unknown>): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>('/metrics/events', {
      method: 'POST',
      body: JSON.stringify({ eventType, metadata: metadata ?? {} }),
    }),

  getImpactMetrics: (): Promise<ImpactMetrics> => request<ImpactMetrics>('/metrics/impact'),
};
