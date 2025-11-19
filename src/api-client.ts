import axios, { AxiosInstance } from 'axios';

export interface GlucoseReading {
  value: number;
  unit: string;
  date: string;
  source: string;
}

export interface GlucoseStats {
  count: number;
  average: number;
  min: number;
  max: number;
  unit: string;
}

export class HealthDataAPI {
  private client: AxiosInstance;
  private apiSecret?: string;
  private accessToken?: string;

  constructor(baseURL: string, authToken: string, isBearer: boolean = false) {
    if (isBearer) {
      // OAuth Bearer token authentication
      this.accessToken = authToken;
      this.client = axios.create({
        baseURL,
        timeout: 30000,
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
    } else {
      // Legacy API secret authentication
      this.apiSecret = authToken;
      this.client = axios.create({
        baseURL,
        timeout: 30000,
        headers: {
          'X-API-Secret': authToken,
        },
      });
    }
  }

  /**
   * Get glucose readings within a date range
   */
  async getGlucoseReadings(params: {
    userId: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<GlucoseReading[]> {
    const queryParams = new URLSearchParams({
      userId: params.userId,
      type: 'BloodGlucose',
    });

    if (params.startDate) queryParams.append('startDate', params.startDate);
    if (params.endDate) queryParams.append('endDate', params.endDate);
    if (params.limit) queryParams.append('limit', params.limit.toString());

    const response = await this.client.get(`/api/samples?${queryParams}`);

    return response.data.samples.map((s: any) => ({
      value: s.value,
      unit: s.unit,
      date: s.start_date,
      source: s.source,
    }));
  }

  /**
   * Get the latest glucose reading
   */
  async getLatestGlucose(userId: string): Promise<GlucoseReading | null> {
    try {
      const response = await this.client.get('/api/samples/latest', {
        params: {
          userId,
          type: 'BloodGlucose',
        },
      });

      const sample = response.data;
      return {
        value: sample.value,
        unit: sample.unit,
        date: sample.start_date,
        source: sample.source,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get glucose statistics
   */
  async getGlucoseStats(params: {
    userId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<GlucoseStats | null> {
    try {
      const queryParams = new URLSearchParams({
        userId: params.userId,
        type: 'BloodGlucose',
      });

      if (params.startDate) queryParams.append('startDate', params.startDate);
      if (params.endDate) queryParams.append('endDate', params.endDate);

      const response = await this.client.get(`/api/samples/stats?${queryParams}`);

      return {
        count: parseInt(response.data.count),
        average: parseFloat(response.data.average),
        min: parseFloat(response.data.min),
        max: parseFloat(response.data.max),
        unit: response.data.unit,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
