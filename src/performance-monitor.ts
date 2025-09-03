import { MEMORY_LIMITS } from './constants';

export interface PerformanceMetrics {
  memoryUsage: NodeJS.MemoryUsage;
  timestamp: number;
  stage: string;
  itemsProcessed?: number;
  timeElapsed?: number;
}

export class PerformanceMonitor {
  private startTime: number;
  private metrics: PerformanceMetrics[] = [];
  private stage: string = 'unknown';

  constructor() {
    this.startTime = Date.now();
  }

  setStage(stage: string): void {
    this.stage = stage;
    this.recordMetrics();
  }

  recordMetrics(itemsProcessed?: number): void {
    const now = Date.now();
    const memory = process.memoryUsage();
    
    this.metrics.push({
      memoryUsage: memory,
      timestamp: now,
      stage: this.stage,
      itemsProcessed,
      timeElapsed: now - this.startTime
    });

    // Log memory warnings for large datasets
    const memoryMB = Math.round(memory.heapUsed / 1024 / 1024);
    if (memoryMB > MEMORY_LIMITS.WARNING_MB) {
      console.log(`⚠️ High memory usage: ${memoryMB}MB heap used in stage "${this.stage}"`);
    }

    // Force garbage collection if available (useful for testing)
    if (global.gc && memoryMB > MEMORY_LIMITS.GC_TRIGGER_MB) {
      console.log('🗑️ Running garbage collection...');
      global.gc();
      const afterGC = process.memoryUsage();
      const afterMB = Math.round(afterGC.heapUsed / 1024 / 1024);
      console.log(`Memory after GC: ${afterMB}MB (freed ${memoryMB - afterMB}MB)`);
    }
  }

  getLatestMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  getSummary(): {
    totalTime: number;
    peakMemoryMB: number;
    averageMemoryMB: number;
    stages: string[];
    finalMetrics: PerformanceMetrics | null;
  } {
    const totalTime = Date.now() - this.startTime;
    const memoryUsages = this.metrics.map(m => m.memoryUsage.heapUsed);
    const peakMemory = Math.max(...memoryUsages) / 1024 / 1024;
    const averageMemory = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length / 1024 / 1024;
    const stages = [...new Set(this.metrics.map(m => m.stage))];

    return {
      totalTime,
      peakMemoryMB: Math.round(peakMemory),
      averageMemoryMB: Math.round(averageMemory),
      stages,
      finalMetrics: this.getLatestMetrics()
    };
  }

  logSummary(): void {
    const summary = this.getSummary();
    console.log('\n📊 Performance Summary:');
    console.log(`⏱️ Total Time: ${Math.round(summary.totalTime / 1000)}s`);
    console.log(`🧠 Peak Memory: ${summary.peakMemoryMB}MB`);
    console.log(`📈 Average Memory: ${summary.averageMemoryMB}MB`);
    console.log(`🎯 Stages: ${summary.stages.join(' → ')}`);
    
    if (summary.finalMetrics?.itemsProcessed) {
      const itemsPerSecond = Math.round(summary.finalMetrics.itemsProcessed / (summary.totalTime / 1000));
      console.log(`⚡ Processing Rate: ${itemsPerSecond} items/second`);
    }
  }
}