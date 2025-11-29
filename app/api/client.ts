// API client for frontend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = localStorage.getItem('access_token');
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'An error occurred' }));
      throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // Auth endpoints
  async register(email: string, password: string) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async login(email: string, password: string) {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);

    const response = await fetch(`${this.baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();
    localStorage.setItem('access_token', data.access_token);
    return data;
  }

  async getCurrentUser() {
    return this.request('/api/auth/me');
  }

  // League endpoints
  async getLeagues() {
    return this.request('/api/leagues/');
  }

  async createLeague(leagueData: {
    platform: string;
    platform_league_id: string;
    name: string;
  }) {
    return this.request('/api/leagues/', {
      method: 'POST',
      body: JSON.stringify(leagueData),
    });
  }

  async syncLeague(leagueId: number) {
    return this.request(`/api/leagues/${leagueId}/sync`, {
      method: 'POST',
    });
  }

  // Yahoo OAuth
  async authorizeYahoo() {
    window.location.href = `${this.baseUrl}/api/auth/yahoo/authorize`;
  }
}

export const apiClient = new ApiClient();

