import React, { useEffect, useRef } from 'react';
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
    HistogramSeries
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
    onChartReady?: (chart: IChartApi) => void | (() => void);
}

const TradingViewChart: React.FC<TradingViewChartProps> = ({ data, type, height = 300, onChartReady }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
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
            }
        });

        // Expose chart instance if requested and capture cleanup
        let cleanupFn: (() => void) | void;
        if (onChartReady) {
            cleanupFn = onChartReady(chart);
        }

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
                autoScale: false,
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            });

        } else if (type === IndicatorType.MACD) {
            const histSeries = chart.addSeries(HistogramSeries, {
                color: `${COLOR_BULLISH}88`,
                title: 'Histogram',
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
            });

            const signalLineData: LineData[] = formattedData
                .filter(d => d.macdSignal !== undefined && !isNaN(d.macdSignal))
                .map(d => ({
                    time: d.time,
                    value: d.macdSignal!,
                }));

            signalLineSeries.setData(signalLineData);
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            if (cleanupFn && typeof cleanupFn === 'function') {
                cleanupFn();
            }
            chart.remove();
        };
    }, [data, type, height]);

    return <div ref={chartContainerRef} className="w-full h-full" />;
};

export default TradingViewChart;
