import $ from "https://deno.land/x/dax@0.31.0/mod.ts"

import { walk } from "https://deno.land/std@0.224.0/fs/mod.ts"
import {
    SEPARATOR,
    join,
    parse,
    relative,
    resolve
} from "https://deno.land/std@0.224.0/path/mod.ts"

const SEPARATOR_KEY = "----"

async function prepare(
    indir: string,
    outdir: string,
): Promise<[string, number, string][]> {
    const outfiles: [string, number, string][] = []
    // Create tmporary dir
    const tmpdir = await Deno.makeTempDir({ prefix: "taped_" })
    for await (const file of walk(indir, {
        includeDirs: false,
        exts: [".wav", "mp3"],
        followSymlinks: true,
        canonicalize: false,
    })) {

        // Get input file
        const infile = resolve(file.path)
        const rel = parse(relative(indir, infile))

        // Normalize name
        const name = `${rel.dir}${SEPARATOR}${rel.name}`
        const name_safe = name.replaceAll(SEPARATOR, SEPARATOR_KEY)

        // Get temporary file
        const tmpfile = join(tmpdir, `${name_safe}.wav`)

        // Show info
        console.info(`Prepare: ${infile} => ${tmpfile}`)

        // Create temporary
        await $`sox ${infile} ${tmpfile} rate 24000 silence 1 0.01 0% reverse silence 1 0.01 0% reverse norm -0.3 gain -10`
            .quiet("both")

        // Ceil duration
        const duration = parseFloat(await $`sox --i -D ${tmpfile}`.text())
        const ceiled = Math.ceil(duration * 10) / 10

        // Apply duraiton
        const outfile = join(outdir, `${name_safe}.wav`)
        await $`sox ${tmpfile} ${outfile} pad 0 0.1 trim 0 ${ceiled}`.quiet(
            "stderr",
        )
        const result = parseFloat(await $`sox --i -D ${outfile}`.text())
        console.assert(
            result === ceiled,
            `Failed to adjust duration: ${infile}`,
        )
        outfiles.push([outfile, result, name])
    }
    await Deno.remove(tmpdir, { recursive: true })
    return outfiles
}

async function concat(infiles: [string, number, string][], outfile: string) {
    const sorted = infiles.toSorted(([a], [b]) => a.localeCompare(b))
    const files = sorted.map(([file]) => file).join(" ")
    await $.raw`sox ${files} ${outfile}`
    return sorted
}

async function intoHowler(infiles: [string, number, string][], outfile: string) {
    let prev = 0
    const names = infiles.map(([, duration, name]) => {
        const result = [name, [prev, duration * 1000]]
        prev += duration * 1000
        return result
    })
    await Deno.writeTextFile(
        outfile,
        JSON.stringify(Object.fromEntries(names)),
    )
}

async function generate(path: string) {
    const tmpdir = await Deno.makeTempDir({ prefix: "taped_" })
    const prepared = await prepare(path, tmpdir)
    const sorted = await concat(prepared, "./sprite.mp3")
    await concat(prepared, "./sprite.ogg")
    await intoHowler(sorted, "./sprite.json")
    await Deno.remove(tmpdir, { recursive: true })
}

if (import.meta.main) {
    const path = Deno.args.at(0)
    if (path === undefined) throw new Error("path not provided.")
    generate(resolve(path))
}
