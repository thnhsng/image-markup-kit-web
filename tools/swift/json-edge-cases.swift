// Writes Foundation's JSONEncoder output ([.prettyPrinted, .sortedKeys], the settings ImageMarkupKit uses for
// document.json and MarkupFeatures) for values at the edges of the format: number formatting, string escaping,
// empty and nested containers, and key order. The TypeScript writer must reproduce these bytes exactly.
//
// Usage: swift tools/swift/json-edge-cases.swift test/fixtures/edge
import Foundation

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

func write<T: Encodable>(_ name: String, _ value: T) throws {
    try encoder.encode(value).write(to: outputDirectory.appendingPathComponent("\(name).json"))
}

let numbers: [Double] = [
    0, -0.0, 1, -1, 2, 10, 100, 255, 600, 1024, 3024, 4032, 123_456_789, 1_000_000,
    0.5, 0.1, 0.2, 0.1 + 0.2, 1.0 / 3, 2.0 / 3, -0.5, 114.75, 899.1008991008991, 0.044301890295913984,
    0.001, 0.0001, 0.00012345, 0.0009999, 0.00009999, 0.00001, 0.000015, 0.0000001, 1.5e-7, 1e-10, 5e-324,
    2.2250738585072014e-308, -0.00001, -1.5e-7,
    1e15, 1e16, 1.5e16, 123_456_789_012_345_680, 1e20, 1e21, 1e22, 1e100, 1.7976931348623157e308, -1e16,
    9_007_199_254_740_991, 9_007_199_254_740_992, 9_007_199_254_740_994, 18_014_398_509_481_984,
    18_014_398_509_481_988, 36_028_797_018_963_968, 4_503_599_627_370_496.5, 4_503_599_627_370_495.5,
    0.1 * 3, 1e-4 * 3, 3.0e-5, 12345.678, 0.000123, 1.0000000000000002, 0.9999999999999999,
]
try write("numbers", numbers)

let strings: [String] = [
    "", "plain", "/", "a/b//c", "\"", "\\", "\u{0}", "\u{1}", "\u{7}", "\u{8}", "\t", "\n", "\u{B}", "\u{C}", "\r",
    "\u{E}", "\u{1B}", "\u{1F}", " ", "\u{7F}", "\u{80}", "\u{85}", "\u{A0}", "\u{2028}", "\u{2029}", "\u{FEFF}",
    "é", "e\u{301}", "日本語", "山小屋 6:00 出発", "😀", "👩‍👩‍👧", "<>&'", "Summit 2,456 m\nBest view!",
    "tab\there", "\r\n", "\u{10FFFF}",
]
try write("strings", strings)

struct Containers: Encodable {
    var emptyArray: [Double] = []
    var emptyObject: [String: Double] = [:]
    var arrayOfEmpty: [[Double]] = [[]]
    var nested: [[Double]] = [[0, 0], [1024, 768]]
    var deep: [String: [String: [Double]]] = ["inner": ["waypoints": [], "points": [1.5, -2]]]
    var flags: [Bool] = [true, false]
    var single: [String] = ["x"]
}
try write("containers", Containers())

let keys: [String: Int] = [
    "b": 1, "a": 2, "B": 3, "A": 4, "a10": 5, "a2": 6, "_x": 7, "Z": 8, "z": 9, "aa": 10, "a_b": 11, "a-b": 12,
    "\u{E9}": 13, "e": 14, "f": 15, "1": 16, "10": 17, "9": 18, "": 19, "aB": 20, "ab": 21, "Ab": 22,
    "isLocked": 23, "id": 24, "isClosed": 25, "itemID": 26, "endHead": 27, "end": 28,
]
try write("keys", keys)

print("wrote numbers, strings, containers, keys to \(outputDirectory.path)")
