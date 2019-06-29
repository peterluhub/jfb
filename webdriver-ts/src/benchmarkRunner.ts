import { BenchmarkType, Benchmark, benchmarks, fileName, LighthouseData } from './benchmarks'
import * as fs from 'fs';
import * as yargs from 'yargs';
import { JSONResult, config, FrameworkData, initializeFrameworks, BenchmarkError, ErrorsAndWarning, BenchmarkOptions } from './common'
import * as R from 'ramda';
import { fork } from 'child_process';
import { executeBenchmark } from './forkedBenchmarkRunner';
import mapObjIndexed from 'ramda/es/mapObjIndexed';

function forkedRun(frameworks: FrameworkData[], frameworkName: string, keyed: boolean, benchmarkName: string, benchmarkOptions: BenchmarkOptions): Promise<ErrorsAndWarning> {
    if (config.FORK_CHROMEDRIVER) {
        return new Promise(function (resolve, reject) {
            const forked = fork('dist/forkedBenchmarkRunner.js');
            if (config.LOG_DEBUG) console.log("forked child process");
            forked.send({ config, frameworks, keyed, frameworkName, benchmarkName, benchmarkOptions });
            forked.on('message', (msg) => {
                if (config.LOG_DEBUG) console.log("main process got message from child", msg);
                resolve(msg);
            });
        });
    } else {
        return executeBenchmark(frameworks, keyed, frameworkName, benchmarkName, benchmarkOptions);
    }
}

async function runBench(frameworks: FrameworkData[], frameworkNames: string[], benchmarkNames: string[], dir: string) {
    let errors: BenchmarkError[] = [];
    let warnings: String[] = [];

    let runFrameworks = frameworks.filter(f => frameworkNames.some(name => f.fullNameWithKeyedAndVersion.indexOf(name) > -1));
    let runBenchmarks = benchmarks.filter(b => benchmarkNames.some(name => b.id.toLowerCase().indexOf(name) > -1));

    let restart: string = undefined; // 'rx-domh-rxjs-v0.0.2-keyed';
    let index = runFrameworks.findIndex(f => f.fullNameWithKeyedAndVersion===restart);
    if (index>-1) {
        runFrameworks = runFrameworks.slice(index);
    }

    console.log("Frameworks that will be benchmarked", runFrameworks);
    console.log("Benchmarks that will be run", runBenchmarks.map(b => b.id));

    let data: [[FrameworkData, Benchmark]] = <any>[];
    for (let i = 0; i < runFrameworks.length; i++) {
        for (let j = 0; j < runBenchmarks.length; j++) {
            data.push([runFrameworks[i], runBenchmarks[j]]);
        }
    }

    for (let i = 0; i < data.length; i++) {
        let framework = data[i][0];
        let benchmark = data[i][1];


        let benchmarkOptions: BenchmarkOptions = {
            outputDirectory: dir,
            port: config.PORT.toFixed(),
            remoteDebuggingPort: config.REMOTE_DEBUGGING_PORT,
            chromePort: config.CHROME_PORT,
            headless: args.headless,
            chromeBinaryPath: args.chromeBinary,
            numIterationsForCPUBenchmarks: config.REPEAT_RUN,
            numIterationsForMemBenchmarks: config.REPEAT_RUN_MEM,
            numIterationsForStartupBenchmark: config.REPEAT_RUN_STARTUP
        }

        try {
            let errorsAndWarnings: ErrorsAndWarning = await forkedRun(frameworks, framework.name, framework.keyed, benchmark.id, benchmarkOptions);
            errors.splice(errors.length, 0, ...errorsAndWarnings.errors);
            warnings.splice(warnings.length, 0, ...errorsAndWarnings.warnings);
        } catch (err) {
            console.log(`Error executing benchmark ${framework.name} and benchmark ${benchmark.id}`);
        }
    }

    if (warnings.length > 0) {
        console.log("================================");
        console.log("The following warnings were logged:");
        console.log("================================");

        warnings.forEach(e => {
            console.log(e);
        });
    }

    if (errors.length > 0) {
        console.log("================================");
        console.log("The following benchmarks failed:");
        console.log("================================");

        errors.forEach(e => {
            console.log("[" + e.imageFile + "]");
            console.log(e.exception);
            console.log();
        });
        throw "Benchmarking failed with errors";
    }
}

let args = yargs(process.argv)
    .usage("$0 [--framework Framework1 Framework2 ...] [--benchmark Benchmark1 Benchmark2 ...] [--count n] [--exitOnError]")
    .help('help')
    .default('check', 'false')
    .default('fork', 'true')
    .boolean('noResults')
    .default('exitOnError', 'false')
    .default('count', Number.MAX_SAFE_INTEGER)
    .default('port', config.PORT)
    .string('chromeBinary')
    .string('chromeDriver')
    .boolean('headless')
    .array("framework").array("benchmark").argv;

async function main() {
    let frameworks = await initializeFrameworks();


    let runBenchmarks = (args.benchmark && args.benchmark.length > 0 ? args.benchmark : [""]).map(v => v.toString());
    let runFrameworks = (args.framework && args.framework.length > 0 ? args.framework : [""]).map(v => v.toString());
    let count = Number(args.count);
    config.PORT = Number(args.port);
    if (count < Number.MAX_SAFE_INTEGER) config.REPEAT_RUN = count;
    config.REPEAT_RUN_MEM = Math.min(count, config.REPEAT_RUN_MEM);
    config.REPEAT_RUN_STARTUP = Math.min(count, config.REPEAT_RUN_STARTUP);
    config.FORK_CHROMEDRIVER = args.fork === 'true';
    config.WRITE_RESULTS = !args.noResults;

    console.log(args, "no-results", args.noResults, config.WRITE_RESULTS);

    let dir = args.check === 'true' ? "results_check" : "results"
    let exitOnError = args.exitOnError === 'true'

    config.EXIT_ON_ERROR = exitOnError;

    console.log("fork chromedriver process?", config.FORK_CHROMEDRIVER);

    if (!fs.existsSync(dir))
    fs.mkdirSync(dir);

    if (args.help) {
        yargs.showHelp();
    } else {
        runBench(frameworks, runFrameworks, runBenchmarks, dir).then(_ => {
                console.log("successful run");
        }).catch(error => {
            console.log("run was not completely sucessful");
        })
    }
}

main();