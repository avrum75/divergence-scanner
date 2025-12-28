import React, { useEffect, useRef, useState } from 'react';
import {
    createChart,
    ColorType,
    IChartApi,
    CandlestickData,
    LineData,
    HistogramData,
    UTCTimestamp,
    CandlestickSeries,
    LineSeries,
    HistogramSeries,
    ISeriesApi,
    CrosshairMode
} from 'lightweight-charts';
import { IndicatorData, IndicatorType } from '../types';
import {
    COLOR_BULLISH,
    COLOR_BEARISH,
    COLOR_RSI,
    COLOR_MACD_LINE,
    COLOR_MACD_SIGNAL
} from '../constants';

interface TradingViewChartProps {
    data: IndicatorData[];
    type: 'PRICE' | IndicatorType;
    height?: number;
    onChartReady?: (chart: IChartApi, mainSeries: ISeriesApi<any>) => void | (() => void);
}

const TradingViewChart: React.FC<TradingViewChartProps> = ({ data, type, height = 300, onChartReady }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const measureLineRef = useRef<ISeriesApi<'Line'> | null>(null);
    const [measureData, setMeasureData] = useState<{
        start: { price: number; time: UTCTimestamp } | null;
        end: { price: number; time: UTCTimestamp } | null;
        priceChange: number;
        percentChange: number;
        bars: number;
        x: number;
        y: number;
    } | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) {
            console.warn('TradingViewChart: chartContainerRef.current is null');
            return;
        }

        let chart: IChartApi | null = null;
        let cleanupFn: (() => void) | void;
        try {
            chart = createChart(chartContainerRef.current, {
                layout: {
                    background: { type: ColorType.Solid, color: '#0f172a' }, // slate-950
                    textColor: '#94a3b8',
                },
                grid: {
                    vertLines: { color: '#1e293b' },
                    horzLines: { color: '#1e293b' },
                },
                width: chartContainerRef.current.clientWidth,
                height: height,
                timeScale: {
                    borderColor: '#334155',
                    timeVisible: true,
                    secondsVisible: false,
                },
                rightPriceScale: {
                    borderColor: '#334155',
                },
                handleScale: {
                    axisPressedMouseMove: {
                        time: true,
                        price: true,
                    }
                },
                crosshair: {
                    mode: CrosshairMode.Normal, // Normal mode - allows free movement (not snapping to candles)
                    vertLine: {
                        color: '#94a3b8',
                        width: 1,
                        style: 0,
                        visible: true,
                    },
                    horzLine: {
                        color: '#94a3b8',
                        width: 1,
                        style: 0,
                        visible: true,
                    }
                }
            });

            chartRef.current = chart;

            const handleResize = () => {
                if (chartContainerRef.current) {
                    chart.applyOptions({ width: chartContainerRef.current.clientWidth });
                }
            };

            window.addEventListener('resize', handleResize);

            // Prepare data
            const formattedData = data.map(d => ({
                ...d,
                time: (new Date(d.time).getTime() / 1000) as UTCTimestamp,
            })).sort((a, b) => (a.time as number) - (b.time as number));

            // Store main series reference for measure tool
            let mainSeries: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;

            if (type === 'PRICE') {
                const candleSeries = chart.addSeries(CandlestickSeries, {
                    upColor: COLOR_BULLISH,
                    downColor: COLOR_BEARISH,
                    borderVisible: false,
                    wickUpColor: COLOR_BULLISH,
                    wickDownColor: COLOR_BEARISH,
                });

                const candleData: CandlestickData[] = formattedData.map(d => ({
                    time: d.time,
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close,
                }));

                candleSeries.setData(candleData);
                mainSeries = candleSeries;

                // EMA 20 removed per user request
                // const emaSeries = chart.addSeries(LineSeries, {
                //     color: '#fbbf24', // amber-400
                //     lineWidth: 2,
                //     title: 'EMA 20',
                // });

                // const emaData: LineData[] = formattedData
                //     .filter(d => d.ema !== undefined && !isNaN(d.ema))
                //     .map(d => ({
                //         time: d.time,
                //         value: d.ema!,
                //     }));

                // emaSeries.setData(emaData);

            } else if (type === IndicatorType.RSI) {
                const rsiSeries = chart.addSeries(LineSeries, {
                    color: COLOR_RSI,
                    lineWidth: 2,
                    title: 'RSI(14)',
                });

                const rsiData: LineData[] = formattedData
                    .filter(d => d.rsi !== undefined && !isNaN(d.rsi))
                    .map(d => ({
                        time: d.time,
                        value: d.rsi!,
                    }));

                rsiSeries.setData(rsiData);
                mainSeries = rsiSeries;

                // Add Overbought/Oversold lines
                const obLine = chart.addSeries(LineSeries, {
                    color: '#ef4444',
                    lineWidth: 1,
                    lineStyle: 1, // Dotted
                });
                obLine.setData(formattedData.map(d => ({ time: d.time, value: 70 })));

                const osLine = chart.addSeries(LineSeries, {
                    color: '#22c55e',
                    lineWidth: 1,
                    lineStyle: 1, // Dotted
                });
                osLine.setData(formattedData.map(d => ({ time: d.time, value: 30 })));

                chart.priceScale('right').applyOptions({
                    // Fixed range 0-100 for RSI
                    autoScale: false,
                    scaleMargins: {
                        top: 0.05,
                        bottom: 0.05,
                    },
                });

                // Force fixed range using autoscaleInfoProvider
                rsiSeries.applyOptions({
                    autoscaleInfoProvider: () => ({
                        priceRange: {
                            minValue: 0,
                            maxValue: 100,
                        },
                    }),
                });

            } else if (type === IndicatorType.MACD) {
                const histSeries = chart.addSeries(HistogramSeries, {
                    color: `${COLOR_BULLISH}88`,
                    title: 'Histogram',
                    priceScaleId: 'right',
                });

                const histData: HistogramData[] = formattedData
                    .filter(d => d.macdHist !== undefined && !isNaN(d.macdHist))
                    .map(d => ({
                        time: d.time,
                        value: d.macdHist!,
                        color: d.macdHist! >= 0 ? `${COLOR_BULLISH}88` : `${COLOR_BEARISH}88`,
                    }));

                histSeries.setData(histData);

                const macdLineSeries = chart.addSeries(LineSeries, {
                    color: COLOR_MACD_LINE,
                    lineWidth: 2,
                    priceScaleId: 'right',
                });

                const macdLineData: LineData[] = formattedData
                    .filter(d => d.macd !== undefined && !isNaN(d.macd))
                    .map(d => ({
                        time: d.time,
                        value: d.macd!,
                    }));

                macdLineSeries.setData(macdLineData);

                const signalLineSeries = chart.addSeries(LineSeries, {
                    color: COLOR_MACD_SIGNAL,
                    lineWidth: 2,
                    priceScaleId: 'right',
                });

                const signalLineData: LineData[] = formattedData
                    .filter(d => d.macdSignal !== undefined && !isNaN(d.macdSignal))
                    .map(d => ({
                        time: d.time,
                        value: d.macdSignal!,
                    }));

                signalLineSeries.setData(signalLineData);

                chart.priceScale('right').applyOptions({
                    autoScale: true,
                    scaleMargins: {
                        top: 0.15,
                        bottom: 0.25,
                    },
                });
                mainSeries = macdLineSeries;
            }

            // Expose chart instance if requested and capture cleanup
            if (onChartReady && mainSeries) {
                cleanupFn = onChartReady(chart, mainSeries);
            }

            // ===== MEASURE TOOL IMPLEMENTATION =====
            let isShiftPressed = false;
            let measureStart: { price: number; time: UTCTimestamp; seriesPrice: number } | null = null;
            let measureEnd: { price: number; time: UTCTimestamp; seriesPrice: number } | null = null;
            let measureLine: ISeriesApi<'Line'> | null = null;
            let currentCrosshairPrice: number | null = null;
            let currentCrosshairTime: UTCTimestamp | null = null;
            let crosshairUnsubscriber: (() => void) | null = null;
            let isUpdatingMeasureLine = false; // Guard to prevent infinite loops
            let lastUpdateTime = 0;
            const UPDATE_THROTTLE_MS = 16; // ~60fps

            // Create measure line series
            const createMeasureLine = () => {
                if (measureLine) {
                    chart.removeSeries(measureLine);
                }
                measureLine = chart.addSeries(LineSeries, {
                    color: '#8b5cf6', // violet-500
                    lineWidth: 2,
                    lineStyle: 2, // Dashed
                    priceLineVisible: false,
                    lastValueVisible: false,
                });
                measureLineRef.current = measureLine;
                return measureLine;
            };

            const clearMeasure = () => {
                if (measureLine) {
                    chart.removeSeries(measureLine);
                    measureLine = null;
                    measureLineRef.current = null;
                }
                measureStart = null;
                measureEnd = null;
                setMeasureData(null);
            };

            const updateMeasureTooltip = () => {
                if (!measureStart || !measureEnd || !mainSeries) return;

                try {
                    const priceChange = measureEnd.price - measureStart.price;
                    const percentChange = measureStart.price !== 0 ? (priceChange / measureStart.price) * 100 : 0;

                    // Calculate number of bars between start and end
                    const startIndex = formattedData.findIndex(d => d.time === measureStart!.time);
                    const endIndex = formattedData.findIndex(d => d.time === measureEnd!.time);
                    const bars = Math.abs(endIndex - startIndex);

                    // Use library-native methods for tooltip coordinates
                    const timeScale = chart.timeScale();
                    const x = timeScale.timeToCoordinate(measureEnd.time);
                    const y = mainSeries.priceToCoordinate(measureEnd.price);

                    if (x !== null && y !== null) {
                        setMeasureData({
                            start: { price: measureStart.price, time: measureStart.time },
                            end: { price: measureEnd.price, time: measureEnd.time },
                            priceChange,
                            percentChange,
                            bars,
                            x,
                            y
                        });
                    }
                } catch (e) {
                    console.error('Error updating measure tooltip:', e);
                }
            };

            // Track SHIFT key
            const handleKeyDown = (e: KeyboardEvent) => {
                // Check for both left and right shift keys
                if ((e.key === 'Shift' || e.keyCode === 16 || e.shiftKey) && !e.repeat) {
                    isShiftPressed = true;
                    if (chartContainerRef.current) {
                        chartContainerRef.current.style.cursor = 'crosshair';
                        // Also set on the chart's canvas if possible
                        const canvas = chartContainerRef.current.querySelector('canvas');
                        if (canvas) {
                            canvas.style.cursor = 'crosshair';
                        }
                    }
                }
            };

            const handleKeyUp = (e: KeyboardEvent) => {
                if (e.key === 'Shift' || e.keyCode === 16 || !e.shiftKey) {
                    isShiftPressed = false;
                    if (chartContainerRef.current) {
                        chartContainerRef.current.style.cursor = 'default';
                        const canvas = chartContainerRef.current.querySelector('canvas');
                        if (canvas) {
                            canvas.style.cursor = 'default';
                        }
                    }
                    // Clear measurement when SHIFT is released
                    clearMeasure();
                }
            };

            // Subscribe to crosshair to get price/time coordinates
            if (mainSeries) {
                const crosshairHandler = (param: any) => {
                    try {
                        if (!isShiftPressed || !param.point || !mainSeries) return;

                        // Use library-native coordinate conversion for 100% accuracy
                        const timeScale = chart.timeScale();
                        const price = mainSeries.coordinateToPrice(param.point.y);
                        const time = timeScale.coordinateToTime(param.point.x) as UTCTimestamp;

                        if (price === null || time === null) return;

                        currentCrosshairPrice = price;
                        currentCrosshairTime = time;

                        // Update measure line if we have a start point
                        if (measureStart && measureLine && !isUpdatingMeasureLine) {
                            const now = Date.now();
                            if (now - lastUpdateTime < UPDATE_THROTTLE_MS) return;

                            measureEnd = {
                                price: currentCrosshairPrice,
                                time: currentCrosshairTime,
                                seriesPrice: currentCrosshairPrice
                            };

                            isUpdatingMeasureLine = true;
                            lastUpdateTime = now;

                            try {
                                const dataPoints = [
                                    { time: measureStart.time, value: measureStart.price },
                                    { time: measureEnd.time, value: measureEnd.price }
                                ].sort((a, b) => (a.time as number) - (b.time as number));

                                measureLine.setData(dataPoints);
                                updateMeasureTooltip();
                            } catch (e) {
                                console.warn('Error updating measure line:', e);
                            } finally {
                                isUpdatingMeasureLine = false;
                            }
                        }
                    } catch (e) {
                        console.error('Error in crosshair move handler:', e);
                    }
                };
                chart.subscribeCrosshairMove(crosshairHandler);
                crosshairUnsubscriber = () => chart.unsubscribeCrosshairMove(crosshairHandler);
            }

            // Handle mouse clicks for measurement
            const handleMouseClick = (e: MouseEvent) => {
                try {
                    if (!isShiftPressed || !mainSeries || !chartContainerRef.current) {
                        return;
                    }

                    // Get click coordinates relative to chart container
                    const rect = chartContainerRef.current.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;

                    // Convert coordinates to time and price using library methods
                    const timeScale = chart.timeScale();
                    const time = timeScale.coordinateToTime(x) as UTCTimestamp;
                    const price = mainSeries.coordinateToPrice(y);

                    if (price === null || time === null) return;

                    // For free-floating measure tool, use the coordinate-based price directly
                    let exactPrice = price;

                    if (!measureStart) {
                        // First click - set start point
                        measureStart = {
                            price: exactPrice,
                            time: time,
                            seriesPrice: exactPrice
                        };
                        createMeasureLine();
                    } else {
                        // Second click - set end point and finalize
                        measureEnd = {
                            price: exactPrice,
                            time: time,
                            seriesPrice: exactPrice
                        };
                        if (measureLine) {
                            const dataPoints = [
                                { time: measureStart.time, value: measureStart.price },
                                { time: measureEnd.time, value: measureEnd.price }
                            ].sort((a, b) => (a.time as number) - (b.time as number));

                            measureLine.setData(dataPoints);
                            updateMeasureTooltip();
                        }
                    }
                } catch (e) {
                    console.error('Error in mouse click handler:', e);
                }
            };

            // Add event listeners (only if mainSeries exists)
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
            if (chartContainerRef.current) {
                chartContainerRef.current.addEventListener('click', handleMouseClick);
            }

            // ===== END MEASURE TOOL =====

            return () => {
                try {
                    window.removeEventListener('resize', handleResize);
                    if (mainSeries) {
                        // Only remove measure tool listeners if they were added
                        try {
                            window.removeEventListener('keydown', handleKeyDown);
                            window.removeEventListener('keyup', handleKeyUp);
                            if (chartContainerRef.current) {
                                chartContainerRef.current.removeEventListener('click', handleMouseClick);
                            }
                        } catch (e) {
                            console.warn('Error removing measure tool listeners:', e);
                        }
                    }
                    if (crosshairUnsubscriber) {
                        crosshairUnsubscriber();
                    }
                    if (cleanupFn && typeof cleanupFn === 'function') {
                        cleanupFn();
                    }
                    if (measureLine && chart) {
                        try {
                            chart.removeSeries(measureLine);
                        } catch (e) {
                            // Ignore if series already removed
                        }
                    }
                    if (chart) {
                        chart.remove();
                    }
                } catch (e) {
                    console.error('Error during chart cleanup:', e);
                }
            };
        } catch (e) {
            console.error('Error initializing chart:', e);
            // Still return cleanup function even on error
            return () => {
                try {
                    if (chart) {
                        chart.remove();
                    }
                } catch (cleanupError) {
                    console.error('Error during error cleanup:', cleanupError);
                }
            };
        }
    }, [data, type, height]);

    return (
        <div ref={chartContainerRef} className="w-full h-full relative">
            {measureData && measureData.start && measureData.end && (
                <div
                    className="absolute bg-slate-800/95 border border-violet-500/50 rounded-lg p-2 text-xs text-white shadow-lg z-50 pointer-events-none"
                    style={{
                        left: `${measureData.x}px`,
                        top: `${measureData.y}px`,
                        transform: 'translate(-50%, -100%)',
                        marginTop: '-8px'
                    }}
                >
                    <div className="font-bold text-violet-400 mb-1">Measurement</div>
                    <div className="space-y-1">
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Price Change:</span>
                            <span className={`font-mono font-bold ${measureData.priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {measureData.priceChange >= 0 ? '+' : ''}{measureData.priceChange.toFixed(2)}
                            </span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Percent:</span>
                            <span className={`font-mono font-bold ${measureData.percentChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {measureData.percentChange >= 0 ? '+' : ''}{measureData.percentChange.toFixed(2)}%
                            </span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Bars:</span>
                            <span className="font-mono">{measureData.bars}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">From:</span>
                            <span className="font-mono">{measureData.start.price.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">To:</span>
                            <span className="font-mono">{measureData.end.price.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TradingViewChart;
