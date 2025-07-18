// Test script to demonstrate the BattlEye path fix
const path = require('path');

// Simulate the old problematic behavior
function oldBEPathHandling(bePath) {
    return `-BEpath=${bePath}`;
}

// New improved path handling
function newBEPathHandling(bePath, serverPath) {
    // Helper function to properly quote paths that contain spaces
    const quotePath = (filePath) => {
        if (filePath.includes(' ')) {
            return `"${filePath}"`;
        }
        return filePath;
    };

    // If the BattlEye path is relative, resolve it against the server path
    if (!path.isAbsolute(bePath)) {
        bePath = path.join(serverPath, bePath);
    }
    
    // Always quote the BattlEye path if it contains spaces
    return `-BEpath=${quotePath(bePath)}`;
}

// Test cases
const testCases = [
    {
        name: "Path with spaces (absolute)",
        bePath: "C:\\Users\\admin\\Desktop\\SudoServerNanny\\Servers\\SUDO EU 2 - Test Server\\battleye",
        serverPath: "C:\\Users\\admin\\Desktop\\SudoServerNanny\\Servers\\SUDO EU 2 - Test Server"
    },
    {
        name: "Path with spaces (relative)",
        bePath: "battleye",
        serverPath: "C:\\Users\\admin\\Desktop\\SudoServerNanny\\Servers\\SUDO EU 2 - Test Server"
    },
    {
        name: "Path without spaces",
        bePath: "battleye",
        serverPath: "C:\\DayZServer"
    }
];

console.log("=== BattlEye Path Handling Fix Test ===\n");

testCases.forEach((testCase, index) => {
    console.log(`Test Case ${index + 1}: ${testCase.name}`);
    console.log(`Input BEpath: ${testCase.bePath}`);
    console.log(`Server Path: ${testCase.serverPath}`);
    
    const oldResult = oldBEPathHandling(testCase.bePath);
    const newResult = newBEPathHandling(testCase.bePath, testCase.serverPath);
    
    console.log(`Old (problematic): ${oldResult}`);
    console.log(`New (fixed): ${newResult}`);
    console.log(`Issues fixed: ${oldResult !== newResult ? 'YES' : 'NO'}`);
    console.log("---\n");
});

console.log("=== Problem Analysis ===");
console.log("The original issue was:");
console.log('C:\\Users\\admin\\Desktop\\SudoServerNanny\\Servers\\SUDO -config=serverDZEU2.cfg -port=2306 -cpuCount=4 -profiles=ServerProfiles -BEpath=battleye -dologs -adminlog "-BEpath=\\"C:\\Users\\admin\\Desktop\\SudoServerNanny\\Servers\\SUDO" EU 2 - Test "Server\\battleye\\""');
console.log("\nThis happened because:");
console.log("1. The path contained spaces: 'SUDO EU 2 - Test Server'");
console.log("2. The command line argument wasn't properly quoted");
console.log("3. The shell split the argument at spaces, corrupting the command");
console.log("\nThe fix ensures:");
console.log("1. Paths with spaces are automatically quoted");
console.log("2. Relative paths are resolved against the server directory");
console.log("3. Absolute and relative paths are handled correctly");
