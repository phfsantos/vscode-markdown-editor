/**
 * WeatherWidget - Weather display with API integration
 * Supports OpenWeatherMap API for live weather data
 * Inspired by wigggle-ui weather widget
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetTitle, WidgetContent, WidgetFooter, 
  Label, WidgetSettingsPanel, SettingsToggle
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

// Weather condition icons (using Unicode)
const weatherIcons: Record<string, string> = {
  'sunny': '☀️',
  'clear': '☀️',
  'clouds': '☁️',
  'cloudy': '☁️',
  'partly-cloudy': '⛅',
  'rain': '🌧️',
  'rainy': '🌧️',
  'drizzle': '🌦️',
  'thunderstorm': '⛈️',
  'stormy': '⛈️',
  'snow': '🌨️',
  'snowy': '🌨️',
  'mist': '🌫️',
  'fog': '🌫️',
  'foggy': '🌫️',
  'haze': '🌫️',
  'windy': '💨',
};

// Map OpenWeatherMap condition codes to icons
const owmConditionMap: Record<string, string> = {
  '01d': 'sunny', '01n': 'clear',
  '02d': 'partly-cloudy', '02n': 'partly-cloudy',
  '03d': 'cloudy', '03n': 'cloudy',
  '04d': 'clouds', '04n': 'clouds',
  '09d': 'drizzle', '09n': 'drizzle',
  '10d': 'rain', '10n': 'rain',
  '11d': 'thunderstorm', '11n': 'thunderstorm',
  '13d': 'snow', '13n': 'snow',
  '50d': 'mist', '50n': 'mist',
};

export interface WeatherWidgetConfig {
  location?: string;
  apiKey?: string;          // OpenWeatherMap API key
  temperature?: number;      // Static or fetched temperature
  condition?: string;        // Static or fetched condition
  unit?: 'C' | 'F';
  humidity?: number;
  windSpeed?: number;
  refreshInterval?: number;  // Refresh interval in minutes
  size?: 'sm' | 'md' | 'lg';
}

interface WeatherData {
  temperature: number;
  condition: string;
  conditionIcon: string;
  humidity: number;
  windSpeed: number;
  location: string;
  lastUpdated?: Date;
}

// Settings fields definition for WidgetSettingsPanel
const settingsFields: SettingsField[] = [
  {
    key: 'apiKey',
    label: 'OpenWeatherMap API Key',
    type: 'text',
    placeholder: 'Enter API key (optional)',
    helpText: 'Get free API key at openweathermap.org',
  },
  {
    key: 'location',
    label: 'Location',
    type: 'text',
    placeholder: 'City name (e.g., London, New York)',
  },
  {
    key: 'unit',
    label: 'Temperature Unit',
    type: 'select',
    options: [
      { value: 'C', label: 'Celsius (°C)' },
      { value: 'F', label: 'Fahrenheit (°F)' },
    ],
  },
  {
    key: 'refreshInterval',
    label: 'Refresh Interval (minutes)',
    type: 'number',
  },
];

export const WeatherWidget: React.FC<ReactWidgetProps> = ({ config, onUpdate }) => {
  const widgetConfig = config as any as WeatherWidgetConfig;
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  
  // Active config state - can be updated immediately when settings are saved
  // This allows the widget to use new values before the parent re-renders
  const [activeConfig, setActiveConfig] = useState<WeatherWidgetConfig>(() => ({
    apiKey: widgetConfig.apiKey || '',
    location: widgetConfig.location || 'London',
    unit: widgetConfig.unit || 'C',
    refreshInterval: widgetConfig.refreshInterval || 30,
    size: widgetConfig.size || 'sm',
    temperature: widgetConfig.temperature,
    condition: widgetConfig.condition,
    humidity: widgetConfig.humidity,
    windSpeed: widgetConfig.windSpeed,
  }));
  
  // Sync activeConfig when widgetConfig changes (e.g., from parent re-render)
  useEffect(() => {
    setActiveConfig({
      apiKey: widgetConfig.apiKey || '',
      location: widgetConfig.location || 'London',
      unit: widgetConfig.unit || 'C',
      refreshInterval: widgetConfig.refreshInterval || 30,
      size: widgetConfig.size || 'sm',
      temperature: widgetConfig.temperature,
      condition: widgetConfig.condition,
      humidity: widgetConfig.humidity,
      windSpeed: widgetConfig.windSpeed,
    });
  }, [widgetConfig.apiKey, widgetConfig.location, widgetConfig.unit, widgetConfig.refreshInterval, 
      widgetConfig.size, widgetConfig.temperature, widgetConfig.condition, widgetConfig.humidity, widgetConfig.windSpeed]);
  
  // Weather data state
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Size variant
  const size = activeConfig.size || 'sm';
  
  // Fetch weather from OpenWeatherMap API - uses activeConfig
  const fetchWeatherWithConfig = useCallback(async (configToUse: WeatherWidgetConfig) => {
    const apiKey = configToUse.apiKey;
    const location = configToUse.location || 'London';
    
    console.log('[WeatherWidget] fetchWeatherWithConfig called with:', { apiKey: !!apiKey, location, unit: configToUse.unit });
    
    if (!apiKey) {
      // Use static data if no API key
      setWeather({
        temperature: configToUse.temperature ?? 20,
        condition: configToUse.condition || 'sunny',
        conditionIcon: 'sunny',
        humidity: configToUse.humidity ?? 65,
        windSpeed: configToUse.windSpeed ?? 10,
        location: location || 'Unknown',
      });
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const units = configToUse.unit === 'F' ? 'imperial' : 'metric';
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=${units}`
      );
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API error: ${response.status}`);
      }
      
      const data = await response.json();
      const iconCode = data.weather?.[0]?.icon || '01d';
      const conditionKey = owmConditionMap[iconCode] || 'cloudy';
      
      setWeather({
        temperature: Math.round(data.main?.temp ?? 0),
        condition: data.weather?.[0]?.description || 'Unknown',
        conditionIcon: conditionKey,
        humidity: data.main?.humidity ?? 0,
        windSpeed: Math.round(data.wind?.speed ?? 0),
        location: data.name || location,
        lastUpdated: new Date(),
      });
    } catch (err) {
      console.error('Weather fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch weather');
      // Fall back to static data
      setWeather({
        temperature: configToUse.temperature ?? 20,
        condition: configToUse.condition || 'sunny',
        conditionIcon: 'sunny',
        humidity: configToUse.humidity ?? 65,
        windSpeed: configToUse.windSpeed ?? 10,
        location: location || 'Unknown',
      });
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Wrapper to fetch with current activeConfig
  const fetchWeather = useCallback(() => {
    fetchWeatherWithConfig(activeConfig);
  }, [fetchWeatherWithConfig, activeConfig]);
  
  // Initial fetch and refresh interval
  useEffect(() => {
    fetchWeather();
    
    const interval = (activeConfig.refreshInterval || 30) * 60 * 1000;
    const timer = setInterval(fetchWeather, interval);
    
    return () => clearInterval(timer);
  }, [fetchWeather, activeConfig.refreshInterval]);
  
  // Save settings - receives values from WidgetSettingsPanel
  const handleSaveSettings = useCallback((values: Record<string, any>) => {
    console.log('[WeatherWidget] values from WidgetSettingsPanel:', values);
    
    const updatedConfig: WeatherWidgetConfig = {
      ...activeConfig,
      apiKey: values.apiKey as string,
      location: values.location as string,
      unit: values.unit as 'C' | 'F',
      refreshInterval: values.refreshInterval as number,
    };
    
    console.log('[WeatherWidget] updatedConfig to save:', updatedConfig);
    
    // IMMEDIATELY update activeConfig so the widget uses new values
    setActiveConfig(updatedConfig);
    
    // Notify parent
    if (onUpdate) {
      onUpdate({ _config: updatedConfig });
    }
    
    // Dispatch custom event for WidgetRenderer
    // Include widgetId from config so handler can find the right container
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: { 
        type: 'settings-change', 
        config: updatedConfig,
        widgetId: (config as any).id,
      },
    });
    console.log('[WeatherWidget] Dispatching widget-update event with detail:', customEvent.detail);
    document.dispatchEvent(customEvent);
    
    setShowSettings(false);
    
    // Fetch with new config immediately
    fetchWeatherWithConfig(updatedConfig);
  }, [activeConfig, config, onUpdate, fetchWeatherWithConfig]);
  
  // Get display values
  const displayTemp = weather?.temperature ?? widgetConfig.temperature ?? 20;
  const displayCondition = weather?.conditionIcon || widgetConfig.condition || 'sunny';
  const displayLocation = weather?.location || widgetConfig.location || 'Unknown';
  const displayHumidity = weather?.humidity ?? widgetConfig.humidity;
  const displayWindSpeed = weather?.windSpeed ?? widgetConfig.windSpeed;
  const unit = activeConfig.unit || 'C';
  
  const icon = weatherIcons[displayCondition.toLowerCase()] || '🌤️';
  
  // Size-based styles
  const sizeStyles = {
    sm: { iconSize: '48px', tempSize: '4xl' as const, padding: '12px' },
    md: { iconSize: '64px', tempSize: '5xl' as const, padding: '16px' },
    lg: { iconSize: '80px', tempSize: '6xl' as const, padding: '24px' },
  };
  const sizeStyle = sizeStyles[size];

  return (
    <Widget size={size} design="default">
      <WidgetHeader style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
        <WidgetTitle style={{ fontSize: '14px' }}>Weather</WidgetTitle>
        <SettingsToggle onClick={() => setShowSettings(!showSettings)} isOpen={showSettings} />
      </WidgetHeader>
      
      {showSettings ? (
        <WidgetSettingsPanel 
          title="Weather Settings" 
          onClose={() => setShowSettings(false)}
          fields={settingsFields}
          values={activeConfig}
          onSave={handleSaveSettings}
        />
      ) : (
        <>
          <WidgetContent style={{ flexDirection: 'column', gap: '12px', padding: sizeStyle.padding }}>
            {loading ? (
              <span style={{ fontSize: '24px' }}>⏳</span>
            ) : (
              <>
                <span style={{ fontSize: sizeStyle.iconSize }}>{icon}</span>
                <Label size={sizeStyle.tempSize}>{displayTemp}°{unit}</Label>
              </>
            )}
            {error && (
              <span style={{ fontSize: '11px', color: 'var(--vscode-errorForeground)' }}>
                {error}
              </span>
            )}
          </WidgetContent>
          <WidgetFooter style={{ flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <Label size="lg" style={{ fontWeight: 600 }}>{displayLocation}</Label>
            {(displayHumidity !== undefined || displayWindSpeed !== undefined) && (
              <div style={{ display: 'flex', gap: '16px' }}>
                {displayHumidity !== undefined && (
                  <Label variant="muted">💧 {displayHumidity}%</Label>
                )}
                {displayWindSpeed !== undefined && (
                  <Label variant="muted">💨 {displayWindSpeed} {unit === 'F' ? 'mph' : 'km/h'}</Label>
                )}
              </div>
            )}
            {weather?.lastUpdated && (
              <Label variant="muted" style={{ fontSize: '10px' }}>
                Updated: {weather.lastUpdated.toLocaleTimeString()}
              </Label>
            )}
          </WidgetFooter>
        </>
      )}
    </Widget>
  );
};
