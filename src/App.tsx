import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, type Auth as FirebaseAuthType, User } from 'firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, onSnapshot, query, orderBy, doc, deleteDoc, setDoc, type Firestore, Timestamp } from 'firebase/firestore';
import { Line, Pie } from 'react-chartjs-2';
// Correct Chart.js imports for types are already here, but if the environment
// still reports "Cannot find name", defining minimal types within the file
// is a workaround for module resolution issues in constrained environments.
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement } from 'chart.js'; // Removed ChartOptions, TooltipItem from here to redefine locally if needed

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement);

// Declare global variables provided by the Canvas environment for TypeScript
declare const __app_id: string | undefined;
declare const __firebase_config: string | undefined;
declare const __initial_auth_token: string | null | undefined;

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-cashflow-app';
const firebaseConfigRaw = typeof __firebase_config !== 'undefined' ? __firebase_config : '{"apiKey": "YOUR_API_KEY", "authDomain": "YOUR_AUTH_DOMAIN", "projectId": "YOUR_PROJECT_ID", "storageBucket": "YOUR_STORAGE_BUCKET", "messagingSenderId": "YOUR_MESSAGING_SENDER_ID", "appId": "YOUR_APP_ID", "measurementId": "YOUR_MEASUREMENT_ID"}';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app: FirebaseApp | undefined;
let auth: FirebaseAuthType | undefined;
let db: Firestore | undefined;
let firebaseInitialized = false;

// Initialize Firebase once
try {
    const parsedFirebaseConfig = JSON.parse(firebaseConfigRaw);
    if (parsedFirebaseConfig.apiKey && parsedFirebaseConfig.projectId) {
        app = initializeApp(parsedFirebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        firebaseInitialized = true;
        console.log("Firebase initialized successfully.");
    } else {
        console.warn("Firebase configuration is incomplete or missing. Please provide valid Firebase config.");
    }
} catch (e: unknown) {
    console.error("Failed to parse Firebase config or initialize Firebase:", (e as Error).message);
}

// --- Type Definitions (Consolidated) ---
// These are defined here to ensure they are available within this single consolidated file,
// especially if external @types packages are not correctly resolved by the environment.
interface ChartOptions<TType extends Chart.ChartType = Chart.ChartType> extends Chart.ChartOptions<TType> {}
interface TooltipItem<TType extends Chart.ChartType = Chart.ChartType> extends Chart.TooltipItem<TType> {}


interface ModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onClose: () => void;
    onConfirm?: () => void;
    showConfirmButton?: boolean;
    children?: React.ReactNode;
}

interface AuthContextType {
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name: string) => Promise<void>;
}

interface NavbarProps {
    userId: string | null;
    userName: string | null;
    onLogout: () => void;
    currentPage: string;
    setCurrentPage: (page: string) => void;
}

interface IncomeItem {
    id: string;
    client: string;
    amount: number;
    dueDate: Date;
    status: 'Outstanding' | 'Paid';
    createdAt: Date;
}

interface ExpenseItem {
    id: string;
    vendor: string;
    amount: number;
    category: string;
    date: Date;
    description: string;
    createdAt: Date;
}

interface DeductionItem {
    name: string;
    amount: number;
}

interface LoanItem {
    id: string;
    loanName: string;
    amount: number;
    paymentFrequency: 'monthly' | 'quarterly' | 'annually';
    nextPaymentDate: Date;
}

interface UserProfile {
    currentBalance: number;
    salaryIncome: number; // This is Gross Salary
    salaryFrequency: 'weekly' | 'fortnightly' | 'monthly';
    lastUpdated: Date;
    name: string;
    numberOfDaysOffPerMonth?: number;
    deductions: DeductionItem[];
    loans: LoanItem[];
}

interface IncomeComponentProps {
    addIncome: (item: Omit<IncomeItem, 'id' | 'createdAt'>) => Promise<void>;
    incomes: IncomeItem[];
    updateIncomeStatus: (id: string, status: 'Paid') => Promise<void>;
    deleteIncome: (id: string) => Promise<void>;
}

interface ExpenseComponentProps {
    addExpense: (item: Omit<ExpenseItem, 'id' | 'createdAt'>) => Promise<void>;
    expenses: ExpenseItem[];
    deleteExpense: (id: string) => Promise<void>;
}

interface DashboardComponentProps {
    incomes: IncomeItem[];
    expenses: ExpenseItem[];
    userProfile: UserProfile | null;
}

interface ProfileComponentProps {
    userProfile: UserProfile | null;
    updateUserProfile: (profile: Partial<UserProfile>) => Promise<void>;
    incomes: IncomeItem[];
    expenses: ExpenseItem[];
}


// --- AuthContext Definition ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- useAuth Custom Hook ---
const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

// --- useFirebaseData Custom Hook (Consolidated) ---
const useFirebaseData = () => {
    const [userId, setUserId] = useState<string | null>(null);
    const [userName, setUserName] = useState<string | null>(null);
    const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
    const [incomes, setIncomes] = useState<IncomeItem[]>([]);
    const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [modalInfo, setModalInfo] = useState<{ isOpen: boolean; title: string; message: string }>({ isOpen: false, title: '', message: '' });

    const openModal = (title: string, message: string) => setModalInfo({ isOpen: true, title, message });
    const closeModal = () => setModalInfo({ isOpen: false, title: '', message: '' });

    // 1. Firebase Authentication & User State Management
    useEffect(() => {
        if (!firebaseInitialized || !auth) {
            openModal("Firebase Not Configured",
                "To use Spenditure, you need to provide your Firebase configuration. " +
                "Please add a Firebase project, get its configuration, and set " +
                "the `__firebase_config` global variable in the Canvas environment."
            );
            return;
        }

        const signIn = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error: unknown) {
                console.error("Firebase sign-in error:", (error as Error).message);
                openModal("Authentication Error", `Failed to sign in: ${(error as Error).message}. Please try again.`);
            }
        };

        signIn();

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(null);
            }
            setIsAuthReady(true);
        });

        return () => unsubscribe();
    }, []); // Empty dependency array means this runs once on mount

    // 2. Firestore Data Listeners (Incomes, Expenses, User Profile)
    useEffect(() => {
        if (!userId || !isAuthReady || !firebaseInitialized || !db) return;

        // Income listener
        const incomesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/incomes`), orderBy('createdAt', 'desc'));
        const unsubscribeIncomes = onSnapshot(incomesQuery, (snapshot) => {
            const fetchedIncomes = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                dueDate: (doc.data().dueDate instanceof Timestamp) ? doc.data().dueDate.toDate() : doc.data().dueDate,
                createdAt: (doc.data().createdAt instanceof Timestamp) ? doc.data().createdAt.toDate() : doc.data().createdAt,
            })) as IncomeItem[];
            setIncomes(fetchedIncomes);
        }, (error: unknown) => {
            console.error("Error fetching incomes:", (error as Error).message);
            openModal("Data Error", `Failed to load income data: ${(error as Error).message}`);
        });

        // Expenses listener
        const expensesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/expenses`), orderBy('createdAt', 'desc'));
        const unsubscribeExpenses = onSnapshot(expensesQuery, (snapshot) => {
            const fetchedExpenses = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                date: (doc.data().date instanceof Timestamp) ? doc.data().date.toDate() : doc.data().date,
                createdAt: (doc.data().createdAt instanceof Timestamp) ? doc.data().createdAt.toDate() : doc.data().createdAt,
            })) as ExpenseItem[];
            setExpenses(fetchedExpenses);
        }, (error: unknown) => {
            console.error("Error fetching expenses:", (error as Error).message);
            openModal("Data Error", `Failed to load expense data: ${(error as Error).message}`);
        });

        // User Profile listener
        const userProfileDocRef = doc(db, `artifacts/${appId}/users/${userId}/profile`, 'current');
        const unsubscribeProfile = onSnapshot(userProfileDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const profileData = docSnap.data();
                setUserProfile({
                    currentBalance: profileData.currentBalance || 0,
                    salaryIncome: profileData.salaryIncome || 0,
                    salaryFrequency: profileData.salaryFrequency || 'monthly',
                    lastUpdated: (profileData.lastUpdated instanceof Timestamp) ? profileData.lastUpdated.toDate() : new Date(),
                    name: profileData.name || '',
                    numberOfDaysOffPerMonth: profileData.numberOfDaysOffPerMonth || 0,
                    deductions: profileData.deductions || [],
                    loans: profileData.loans ? profileData.loans.map((loan: any) => ({
                        ...loan,
                        nextPaymentDate: (loan.nextPaymentDate instanceof Timestamp) ? loan.nextPaymentDate.toDate() : loan.nextPaymentDate
                    })) : [],
                } as UserProfile);
                setUserName(profileData.name || '');
            } else {
                // If profile doesn't exist, create a default one
                setUserProfile({
                    currentBalance: 0,
                    salaryIncome: 0,
                    salaryFrequency: 'monthly',
                    lastUpdated: new Date(),
                    name: '',
                    numberOfDaysOffPerMonth: 0,
                    deductions: [],
                    loans: [],
                });
                setUserName(null); // No name until user sets it
            }
        }, (error: unknown) => {
            console.error("Error fetching user profile:", (error as Error).message);
            openModal("Data Error", `Failed to load user profile: ${(error as Error).message}`);
        });

        return () => {
            unsubscribeIncomes();
            unsubscribeExpenses();
            unsubscribeProfile();
        };
    }, [userId, isAuthReady]); // Re-run when userId or auth readiness changes

    // 3. Authentication Actions
    const login = useCallback(async (email: string, password: string) => {
        if (!firebaseInitialized || !auth) throw new Error("Firebase not initialized or auth not available.");
        await signInWithEmailAndPassword(auth, email, password);
    }, [firebaseInitialized, auth]);

    const signup = useCallback(async (email: string, password: string, name: string) => {
        if (!firebaseInitialized || !auth || !db) throw new Error("Firebase not initialized or auth/db not available.");
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (userCredential.user) {
            await setDoc(doc(db, `artifacts/${appId}/users/${userCredential.user.uid}/profile`, 'current'), {
                currentBalance: 0,
                salaryIncome: 0,
                salaryFrequency: 'monthly',
                lastUpdated: new Date(),
                name: name,
                numberOfDaysOffPerMonth: 0,
                deductions: [],
                loans: [],
            });
        }
    }, [firebaseInitialized, auth, db]);

    const logout = useCallback(async () => {
        if (!firebaseInitialized || !auth) return;
        try {
            await signOut(auth);
            // Clear all states on logout
            setUserId(null);
            setUserName(null);
            setIncomes([]);
            setExpenses([]);
            setUserProfile(null);
        } catch (error: unknown) {
            console.error("Logout error:", (error as Error).message);
            openModal("Logout Error", `Failed to log out: ${(error as Error).message}`);
        }
    }, [firebaseInitialized, auth]);

    // 4. Firestore Data CRUD Operations
    const addIncome = useCallback(async (incomeData: Omit<IncomeItem, 'id' | 'createdAt'>) => {
        if (!userId || !firebaseInitialized || !db) throw new Error("User not authenticated or Firebase/Firestore not initialized.");
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/incomes`), { ...incomeData, createdAt: Timestamp.now() });
    }, [userId, firebaseInitialized, db]);

    const updateIncomeStatus = useCallback(async (id: string, newStatus: 'Paid') => {
        if (!userId || !firebaseInitialized || !db) throw new Error("User not authenticated or Firebase/Firestore not initialized.");
        await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/incomes`, id), { status: newStatus });
    }, [userId, firebaseInitialized, db]);

    const deleteIncome = useCallback(async (id: string) => {
        if (!userId || !firebaseInitialized || !db) throw new Error("User not authenticated or Firebase/Firestore not initialized.");
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/incomes`, id));
    }, [userId, firebaseInitialized, db]);

    const addExpense = useCallback(async (expenseData: Omit<ExpenseItem, 'id' | 'createdAt'>) => {
        if (!userId || !firebaseInitialized || !db) throw new Error("User not authenticated or Firebase/Firestore not initialized.");
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/expenses`), { ...expenseData, createdAt: Timestamp.now() });
    }, [userId, firebaseInitialized, db]);

    const deleteExpense = useCallback(async (id: string) => {
        if (!userId || !firebaseInitialized || !db) throw new Error("User not authenticated or Firebase/Firestore not initialized.");
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/expenses`, id));
    }, [userId, firebaseInitialized, db]);

    const updateUserProfile = useCallback(async (profile: Partial<UserProfile>) => {
        if (!userId || !firebaseInitialized || !db) throw new Error("User not authenticated or Firebase/Firestore not initialized.");

        // Convert Date objects in loans to Firestore Timestamps before saving
        const profileToSave = { ...profile };
        if (profileToSave.loans) {
            profileToSave.loans = profileToSave.loans.map(loan => ({
                ...loan,
                nextPaymentDate: Timestamp.fromDate(loan.nextPaymentDate)
            }));
        }

        await setDoc(doc(db, `artifacts/${appId}/users/${userId}/profile`, 'current'), { ...profileToSave, lastUpdated: Timestamp.now() }, { merge: true });
    }, [userId, firebaseInitialized, db]);

    return {
        userId,
        userName,
        isAuthReady,
        incomes,
        expenses,
        userProfile,
        login,
        signup,
        logout,
        addIncome,
        updateIncomeStatus,
        deleteIncome,
        addExpense,
        deleteExpense,
        updateUserProfile,
        modalInfo,
        closeModal,
        firebaseInitialized // Export this flag
    };
};

// --- Utility Function: generateMockForecast (Consolidated) ---
const generateMockForecast = (currentBalance: number, incomes: IncomeItem[], expenses: ExpenseItem[], userProfile: UserProfile | null) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    let maxRelevantDate = new Date(today); // Start with today

    // Find the latest future date from outstanding incomes
    incomes.forEach(inc => {
        // Only consider outstanding incomes that are due today or in the future
        if (inc.status === 'Outstanding' && inc.dueDate.getTime() >= today.getTime()) {
            if (inc.dueDate.getTime() > maxRelevantDate.getTime()) {
                maxRelevantDate = inc.dueDate;
            }
        }
    });

    // Find the latest future date from expenses
    expenses.forEach(exp => {
        // Only consider expenses that are today or in the future
        if (exp.date.getTime() >= today.getTime()) {
            if (exp.date.getTime() > maxRelevantDate.getTime()) {
                maxRelevantDate = exp.date;
            }
        }
    });

    const oneDayInMillis = 24 * 60 * 60 * 1000;
    // Calculate number of full days from today to maxRelevantDate
    // If maxRelevantDate is today, daysToProject will be 0.
    const daysToProject = Math.floor((maxRelevantDate.getTime() - today.getTime()) / oneDayInMillis);

    // Ensure projection extends at least 30 days even if no future data, for graph visibility
    const effectiveProjectionDays = Math.max(daysToProject, 30);
    const chartEndDate = new Date(today);
    chartEndDate.setDate(today.getDate() + effectiveProjectionDays);

    let currentProjectedBalance = currentBalance;
    let potentialShortfallDate: Date | null = null;
    let hasShortfall = false;

    // Map to aggregate all financial events on specific days
    const transactionsByDay = new Map<string, number>(); // date string (YYYY-MM-DD) -> net amount

    // Add existing incomes to the map
    incomes.forEach(inc => {
        if (inc.status === 'Outstanding' && inc.dueDate.getTime() >= today.getTime()) {
            const dateKey = inc.dueDate.toISOString().split('T')[0];
            transactionsByDay.set(dateKey, (transactionsByDay.get(dateKey) || 0) + inc.amount);
        }
    });

    // Add existing expenses to the map
    expenses.forEach(exp => {
        if (exp.date.getTime() >= today.getTime()) {
            const dateKey = exp.date.toISOString().split('T')[0];
            transactionsByDay.set(dateKey, (transactionsByDay.get(dateKey) || 0) - exp.amount);
        }
    });

    const projectedSalaryPayments: IncomeItem[] = []; // Changed to const

    // Calculate paydays and add net salary to transactionsByDay
    if (userProfile && userProfile.salaryIncome > 0) {
        const grossMonthlySalary = userProfile.salaryIncome;
        const totalMonthlyDeductions = userProfile.deductions.reduce((sum: number, ded: DeductionItem) => sum + ded.amount, 0); // Explicitly typed
        const netMonthlySalary = grossMonthlySalary - totalMonthlyDeductions;

        let numPayrollsPerMonth = 0;
        if (userProfile.salaryFrequency === 'monthly') numPayrollsPerMonth = 1;
        else if (userProfile.salaryFrequency === 'fortnightly') numPayrollsPerMonth = 2; // Approx
        else if (userProfile.salaryFrequency === 'weekly') numPayrollsPerMonth = 4; // Approx

        const salaryPerPayPeriod = netMonthlySalary / numPayrollsPerMonth;

        const getNextPayday = (currentDate: Date, frequency: 'weekly' | 'fortnightly' | 'monthly'): Date | null => {
            let nextPay = new Date(currentDate);
            nextPay.setHours(0,0,0,0); // Normalize to start of day

            if (frequency === 'monthly') {
                // Aim for the 15th, or adjust if it's already passed or month is short
                nextPay.setDate(15);
                if (nextPay.getTime() < currentDate.getTime()) {
                    nextPay.setMonth(nextPay.getMonth() + 1);
                    nextPay.setDate(15);
                }
                // Handle months with less than 15 days, or if the 15th falls before today after advancing month
                if (nextPay.getDate() < currentDate.getDate() && nextPay.getMonth() === currentDate.getMonth()) {
                     nextPay.setMonth(nextPay.getMonth() + 1); // Move to next month
                }
                // Correct if setting day pushed it to next month
                if (nextPay.getMonth() !== ((currentDate.getMonth() + (nextPay.getTime() < currentDate.getTime() ? 1 : 0)) % 12)) {
                    nextPay = new Date(nextPay.getFullYear(), nextPay.getMonth(), 0); // Last day of previous month (i.e. correct end of month)
                }

            } else if (frequency === 'fortnightly') {
                const day = currentDate.getDate();
                if (day <= 1) { // If today is 1st or earlier, next payday is 1st
                    nextPay.setDate(1);
                } else if (day <= 15) { // If today is between 2nd and 15th, next payday is 15th
                    nextPay.setDate(15);
                } else { // If today is after 15th, next payday is 1st of next month
                    nextPay.setMonth(nextPay.getMonth() + 1);
                    nextPay.setDate(1);
                }
                // If the computed nextPayday is still before current date after initial adjustment, advance it
                if (nextPay.getTime() < currentDate.getTime()) {
                     nextPay.setDate(nextPay.getDate() + 14); // Try next fortnight
                }

            } else if (frequency === 'weekly') {
                // Find next Monday
                const dayOfWeek = nextPay.getDay(); // 0 (Sunday) to 6 (Saturday)
                let daysUntilNextMonday = 0;
                if (dayOfWeek === 0) { // Sunday
                    daysUntilNextMonday = 1;
                } else if (dayOfWeek === 1) { // Monday
                    daysUntilNextMonday = 7; // Next Monday
                } else {
                    daysUntilNextMonday = 8 - dayOfWeek;
                }
                nextPay.setDate(nextPay.getDate() + daysUntilNextMonday);

                // If the nextPay is still before currentDate, advance it by 7 days (to account for edge cases)
                if (nextPay.getTime() < currentDate.getTime()) {
                    nextPay.setDate(nextPay.getDate() + 7);
                }
            } else {
                return null;
            }
            nextPay.setHours(0,0,0,0); // Ensure consistency
            return nextPay;
        };

        let tempDate = new Date(today);
        const projectionLimitDate = new Date(chartEndDate);
        projectionLimitDate.setDate(projectionLimitDate.getDate() + 1); // Go one day beyond for loop

        let loopCount = 0;
        while (tempDate.getTime() <= projectionLimitDate.getTime() && loopCount < 100) { // Safety break for infinite loops
            const nextPay = getNextPayday(tempDate, userProfile.salaryFrequency);

            if (nextPay && nextPay.getTime() <= projectionLimitDate.getTime()) {
                const dateKey = nextPay.toISOString().split('T')[0];
                transactionsByDay.set(dateKey, (transactionsByDay.get(dateKey) || 0) + salaryPerPayPeriod);

                // Add to projectedSalaryPayments for detailed display
                projectedSalaryPayments.push({
                    id: `salary-${dateKey}-${loopCount}`, // Unique ID for each payment
                    client: `Salary Payment (${userProfile.salaryFrequency})`, // More descriptive
                    amount: salaryPerPayPeriod,
                    dueDate: nextPay,
                    status: 'Outstanding',
                    createdAt: new Date(),
                });

                tempDate = new Date(nextPay);
                tempDate.setDate(tempDate.getDate() + 1); // Advance by one day to search for the *next* distinct payday
            } else {
                break; // No more paydays in range
            }
            loopCount++;
        }
    }

    // Project Loan Payments
    if (userProfile && userProfile.loans && userProfile.loans.length > 0) {
        userProfile.loans.forEach(loan => {
            let nextLoanPayment = new Date(loan.nextPaymentDate);
            nextLoanPayment.setHours(0, 0, 0, 0);

            // Project payments within the forecast period (effectiveProjectionDays)
            for (let i = 0; i <= effectiveProjectionDays; i++) {
                const currentIterationDate = new Date(today);
                currentIterationDate.setDate(currentIterationDate.getDate() + i);
                currentIterationDate.setHours(0, 0, 0, 0);

                // Check if currentIterationDate is a payment date for this loan
                if (currentIterationDate.getTime() === nextLoanPayment.getTime()) {
                    const dateKey = currentIterationDate.toISOString().split('T')[0];
                    transactionsByDay.set(dateKey, (transactionsByDay.get(dateKey) || 0) - loan.amount); // Deduct loan amount

                    // Calculate next payment date based on frequency
                    if (loan.paymentFrequency === 'monthly') {
                        nextLoanPayment.setMonth(nextLoanPayment.getMonth() + 1);
                    } else if (loan.paymentFrequency === 'quarterly') {
                        nextLoanPayment.setMonth(nextLoanPayment.getMonth() + 3);
                    } else if (loan.paymentFrequency === 'annually') {
                        nextLoanPayment.setFullYear(nextLoanPayment.getFullYear() + 1);
                    }
                    nextLoanPayment.setHours(0, 0, 0, 0); // Normalize after adjustment
                }
            }
        });
    }

    // Initialize forecast data with today's balance
    const forecastData: { date: Date; balance: number }[] = [{ date: new Date(today), balance: currentProjectedBalance }];
    let currentIterationDate = new Date(today);
    currentIterationDate.setHours(0,0,0,0);

    // Loop through each day from today up to the effectiveProjectionDays
    for (let i = 0; i <= effectiveProjectionDays; i++) {
        const dateKey = currentIterationDate.toISOString().split('T')[0];
        const dailyNetChange = transactionsByDay.get(dateKey) || 0; // Get net change for this specific day, 0 if none

        currentProjectedBalance += dailyNetChange;
        forecastData.push({ date: new Date(currentIterationDate), balance: currentProjectedBalance });

        if (currentProjectedBalance < 0 && !hasShortfall) {
            potentialShortfallDate = new Date(currentIterationDate);
            hasShortfall = true;
        }

        currentIterationDate.setDate(currentIterationDate.getDate() + 1);
    }

    return { forecastData, potentialShortfallDate, projectedSalaryPayments };
};


// --- Component: Modal (Consolidated) ---
const Modal: React.FC<ModalProps> = ({ isOpen, title, message, onClose, onConfirm, showConfirmButton = false, children }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg md:max-w-xl lg:max-w-2xl transform transition-all duration-300 scale-100" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b pb-2">{title}</h3>
                {message && <p className="text-sm text-gray-700 mb-6">{message}</p>}
                {children}
                <div className="flex justify-end space-x-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition duration-200"
                    >
                        {showConfirmButton ? 'Cancel' : 'Close'}
                    </button>
                    {showConfirmButton && onConfirm && (
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition duration-200"
                        >
                            Confirm
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- Component: LoadingSpinner (Consolidated) ---
const LoadingSpinner: React.FC = () => (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="border-4 border-gray-200 border-t-4 border-t-gray-800 rounded-full w-12 h-12 animate-spin"></div>
    </div>
);


// --- Component: Auth (Consolidated) ---
const Auth: React.FC = () => {
    const { login, signup } = useAuth();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalTitle, setModalTitle] = useState('');
    const [modalMessage, setModalMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            if (isLogin) {
                await login(email, password);
            } else {
                if (!name) {
                    setModalTitle("Input Error");
                    setModalMessage("Please enter your name for signup.");
                    setIsModalOpen(true);
                    return;
                }
                await signup(email, password, name);
            }
        } catch (err: unknown) {
            setError((err as Error).message || 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
                <div className="flex justify-center mb-6">
                    <span className="text-gray-900 text-4xl font-bold">Spenditure</span>
                </div>
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md relative mb-4" role="alert">
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}
                <form onSubmit={handleSubmit}>
                    {!isLogin && (
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                                Name
                            </label>
                            <input
                                type="text"
                                id="name"
                                value={name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                placeholder="Your Name"
                                required
                            />
                        </div>
                    )}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                            Email
                        </label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            placeholder="Your email"
                            required
                        />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                            Password
                        </label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            placeholder="********"
                            required
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <button
                            type="submit"
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:shadow-outline w-full disabled:opacity-70 disabled:cursor-not-allowed"
                            disabled={isLoading}
                        >
                            {isLoading ? 'Loading...' : (isLogin ? 'Login' : 'Sign Up')}
                        </button>
                    </div>
                </form>
                <div className="text-center mt-4">
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="inline-block align-baseline font-bold text-sm text-orange-600 hover:text-orange-800"
                    >
                        {isLogin ? 'Need an account? Sign Up' : 'Already have an account? Login'}
                    </button>
                </div>
            </div>
            <Modal
                isOpen={isModalOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsModalOpen(false)}
            />
        </div>
    );
};


// --- Component: Navbar (Consolidated) ---
const Navbar: React.FC<NavbarProps> = ({ userId, userName, onLogout, currentPage, setCurrentPage }) => {
    const navItemClass = (pageName: string) =>
        `px-3 py-2 rounded-md text-sm font-medium transition duration-200 text-gray-300 hover:bg-orange-600 cursor-pointer ${currentPage === pageName ? 'bg-orange-500 text-white shadow-md' : ''}`;

    return (
        <nav className="bg-zinc-900 p-4 shadow-lg sticky top-0 z-40">
            <div className="w-full px-[20px] flex flex-wrap items-center justify-between">
                <div className="flex items-center">
                    {/* Placeholder for the Monie Logo (if you have an SVG or image, replace this) */}
                    {/* For example, if you have public/monies.svg: <img src="/monies.svg" alt="Monie Logo" className="h-8 w-auto" /> */}
                    {/* Using an inline SVG for demonstration (similar to previous version but simplified) */}
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
                        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM12 11.5a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2a.5.5 0 01.5-.5zM12 7a.5.5 0 01.5.5v.5a.5.5 0 01-1 0V7.5a.5.5 0 01.5-.5z" fill="#F97316"/>
                        <circle cx="12" cy="12" r="10" stroke="#F97316" strokeWidth="1.5"/>
                        <path d="M10 8h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V9a1 1 0 011-1z" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <text x="12" y="15" fontSize="10" fontWeight="bold" textAnchor="middle" fill="#FFFFFF">$</text>
                    </svg>
                    <span className="text-white text-2xl font-bold">Spenditure</span>
                </div>

                {/* Navigation Buttons */}
                <div className="flex space-x-4 mt-2 md:mt-0">
                    <button
                        onClick={() => setCurrentPage('dashboard')}
                        className={navItemClass('dashboard')}
                    >
                        Dashboard
                    </button>
                    <button
                        onClick={() => setCurrentPage('income')}
                        className={navItemClass('income')}
                    >
                        Income
                    </button>
                    <button
                        onClick={() => setCurrentPage('expenses')}
                        className={navItemClass('expenses')}
                    >
                        Expenses
                    </button>
                    <button
                        onClick={() => setCurrentPage('profile')}
                        className={navItemClass('profile')}
                    >
                        Profile
                    </button>
                </div>

                {/* User Info and Logout Button */}
                <div className="flex items-center space-x-4 mt-2 md:mt-0 ml-auto">
                    <span className="text-gray-300 text-sm italic hidden sm:block">
                        {userName ? `Welcome, ${userName}!` : 'Welcome!'}
                    </span>
                    <button
                        onClick={onLogout}
                        className="px-4 py-2 bg-orange-500 text-white rounded-md transition duration-200 hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-opacity-50 text-sm"
                    >
                        Logout
                    </button>
                </div>
            </div>
        </nav>
    );
};


// --- Component: Income (Consolidated) ---
const Income: React.FC<IncomeComponentProps> = ({ addIncome, incomes, updateIncomeStatus, deleteIncome }) => {
    const [client, setClient] = useState<string>('');
    const [amount, setAmount] = useState<string>('');
    const [dueDate, setDueDate] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [modalMessage, setModalMessage] = useState<string>('');
    const [modalTitle, setModalTitle] = useState<string>('');
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!client || !amount || !dueDate) {
            setModalTitle("Input Error");
            setModalMessage("Please fill in all fields (Client, Amount, Due Date).");
            setIsModalOpen(true);
            return;
        }
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            setModalTitle("Input Error");
            setModalMessage("Amount must be a positive number.");
            setIsModalOpen(true);
            return;
        }

        try {
            await addIncome({
                client,
                amount: parseFloat(amount),
                dueDate: new Date(dueDate),
                status: 'Outstanding',
            });
            setClient('');
            setAmount('');
            setDueDate('');
            setModalTitle("Success!");
            setModalMessage("Income record added successfully.");
            setIsModalOpen(true);
        } catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to add income: ${(error as Error).message}`);
            setIsModalOpen(true);
        }
    };

    const handleMarkAsPaid = async (id: string) => {
        try {
            await updateIncomeStatus(id, 'Paid');
            setModalTitle("Success!");
            setModalMessage("Invoice marked as paid.");
            setIsModalOpen(true);
        } catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to update status: ${(error as Error).message}`);
            setIsModalOpen(true);
        }
    };

    const handleDeleteClick = (id: string) => {
        setItemToDelete(id);
        setIsConfirmModalOpen(true);
        setModalTitle("Confirm Deletion");
        setModalMessage("Are you sure you want to delete this income record? This action cannot be undone.");
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteIncome(itemToDelete);
            setModalTitle("Success!");
            setModalMessage("Income record deleted successfully.");
            setIsModalOpen(true);
        } catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to delete: ${(error as Error).message}`);
            setIsModalOpen(true);
        } finally {
            setIsConfirmModalOpen(false);
            setItemToDelete(null);
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Income Management</h1>

            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Add New Income</h2>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                        <label htmlFor="client" className="block text-gray-700 text-sm font-bold mb-2">Client Name</label>
                        <input
                            type="text"
                            id="client"
                            value={client}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClient(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            placeholder="e.g., ABC Corp."
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="amount" className="block text-gray-700 text-sm font-bold mb-2">Amount (PHP)</label>
                        <input
                            type="number"
                            id="amount"
                            value={amount}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            placeholder="e.g., 50000"
                            step="0.01"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="dueDate" className="block text-gray-700 text-sm font-bold mb-2">Due Date</label>
                        <input
                            type="date"
                            id="dueDate"
                            value={dueDate}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDueDate(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            required
                        />
                    </div>
                    <div className="col-span-full flex justify-end">
                        <button
                            type="submit"
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-md transition duration-200 shadow-sm cursor-pointer"
                        >
                            Add Income
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Your Income Records</h2>
                {incomes.length === 0 ? (
                    <p className="text-gray-600">No income records yet. Add one above!</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tl-lg">Client</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tr-lg">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {incomes.map((income: IncomeItem) => (
                                    <tr key={income.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{income.client}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">PHP {income.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {income.dueDate.toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            <span className={`inline-flex px-2 py-0.5 text-xs leading-5 font-semibold rounded-full ${income.status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                                                {income.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 flex items-center space-x-2">
                                            {income.status === 'Outstanding' && (
                                                <button
                                                    onClick={() => handleMarkAsPaid(income.id)}
                                                    className="px-2 py-1 text-sm font-medium text-green-700 hover:text-green-900 transition duration-200"
                                                    title="Mark as Paid"
                                                >
                                                    Mark Paid
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDeleteClick(income.id)}
                                                className="px-2 py-1 text-sm font-medium text-orange-700 hover:text-orange-900 transition duration-200"
                                                title="Delete"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modals for alerts and confirmations */}
            <Modal
                isOpen={isModalOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsModalOpen(false)}
            />
            <Modal
                isOpen={isConfirmModalOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={confirmDelete}
                showConfirmButton={true}
            />
        </div>
    );
};


// --- Component: Expense (Consolidated) ---
const Expense: React.FC<ExpenseComponentProps> = ({ addExpense, expenses, deleteExpense }) => {
    const [vendor, setVendor] = useState<string>('');
    const [amount, setAmount] = useState<string>('');
    const [category, setCategory] = useState<string>('Supplies');
    const [date, setDate] = useState<string>('');
    const [description, setDescription] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [modalMessage, setModalMessage] = useState<string>('');
    const [modalTitle, setModalTitle] = useState<string>('');
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);

    // New state for viewing expense details
    const [isViewModalOpen, setIsViewModalOpen] = useState<boolean>(false);
    const [selectedExpense, setSelectedExpense] = useState<ExpenseItem | null>(null);

    const expenseCategories = ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Software', 'Travel', 'Other'];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!vendor || !amount || !category || !date) {
            setModalTitle("Input Error");
            setModalMessage("Please fill in all required fields (Vendor, Amount, Category, Date).");
            setIsModalOpen(true);
            return;
        }
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            setModalTitle("Input Error");
            setModalMessage("Amount must be a positive number.");
            setIsModalOpen(true);
            return;
        }

        try {
            await addExpense({
                vendor,
                amount: parseFloat(amount),
                category,
                date: new Date(date),
                description,
            });
            setVendor('');
            setAmount('');
            setCategory('Supplies');
            setDate('');
            setDescription('');
            setModalTitle("Success!");
            setModalMessage("Expense record added successfully.");
            setIsModalOpen(true);
        } catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to add expense: ${(error as Error).message}`);
            setIsModalOpen(true);
        }
    };

    const handleDeleteClick = (id: string) => {
        setItemToDelete(id);
        setIsConfirmModalOpen(true);
        setModalTitle("Confirm Deletion");
        setModalMessage("Are you sure you want to delete this expense record? This action cannot be undone.");
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteExpense(itemToDelete);
            setModalTitle("Success!");
            setModalMessage("Expense record deleted successfully.");
            setIsModalOpen(true);
        } catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to delete: ${(error as Error).message}`);
            setIsModalOpen(true);
        } finally {
            setIsConfirmModalOpen(false);
            setItemToDelete(null);
        }
    };

    // New function to handle viewing expense details
    const handleViewDetails = (expense: ExpenseItem) => {
        setSelectedExpense(expense);
        setIsViewModalOpen(true);
    };

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Expense Tracking</h1>

            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Record New Expense</h2>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                        <label htmlFor="vendor" className="block text-gray-700 text-sm font-bold mb-2">Vendor</label>
                        <input
                            type="text"
                            id="vendor"
                            value={vendor}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVendor(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            placeholder="e.g., Meralco"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="amount" className="block text-gray-700 text-sm font-bold mb-2">Amount (PHP)</label>
                        <input
                            type="number"
                            id="amount"
                            value={amount}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            placeholder="e.g., 2500"
                            step="0.01"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="category" className="block text-gray-700 text-sm font-bold mb-2">Category</label>
                        <select
                            id="category"
                            value={category}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            required
                        >
                            {expenseCategories.map((cat: string) => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="date" className="block text-gray-700 text-sm font-bold mb-2">Date</label>
                        <input
                            type="date"
                            id="date"
                            value={date}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            required
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="description" className="block text-gray-700 text-sm font-bold mb-2">Description (Optional)</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-y"
                            rows={2}
                            placeholder="Brief description of the expense"
                        ></textarea>
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                        <button
                            type="submit"
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-md transition duration-200 shadow-sm cursor-pointer"
                        >
                            Record Expense
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Your Expense Records</h2>
                {expenses.length === 0 ? (
                    <p className="text-gray-600">No expense records yet. Record one above!</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tl-lg">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tr-lg">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {expenses.map((expense: ExpenseItem) => (
                                    <tr key={expense.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {expense.date.toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{expense.vendor}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{expense.category}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">PHP {expense.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 flex items-center space-x-2">
                                            <button
                                                onClick={() => handleViewDetails(expense)}
                                                className="px-2 py-1 text-sm font-medium text-blue-700 hover:text-blue-900 transition duration-200"
                                                title="View Details"
                                            >
                                                View
                                            </button>
                                            <button
                                                onClick={() => handleDeleteClick(expense.id)}
                                                className="px-2 py-1 text-sm font-medium text-orange-700 hover:text-orange-900 transition duration-200"
                                                title="Delete"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {/* Modals for alerts and confirmations */}
            <Modal
                isOpen={isModalOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsModalOpen(false)}
            />
            <Modal
                isOpen={isConfirmModalOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={confirmDelete}
                showConfirmButton={true}
            />

            {/* Modal for Viewing Expense Details */}
            <Modal
                isOpen={isViewModalOpen}
                title="Expense Details"
                message=""
                onClose={() => setIsViewModalOpen(false)}
            >
                {selectedExpense && (
                    <div className="space-y-3 text-gray-800">
                        <p><strong>Vendor:</strong> {selectedExpense.vendor}</p>
                        <p><strong>Amount:</strong> PHP {selectedExpense.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p><strong>Category:</strong> {selectedExpense.category}</p>
                        <p><strong>Date:</strong> {selectedExpense.date.toLocaleDateString()}</p>
                        <p><strong>Description:</strong> {selectedExpense.description || 'N/A'}</p>
                        <p className="text-xs text-gray-500">Recorded on: {selectedExpense.createdAt.toLocaleString()}</p>
                    </div>
                )}
            </Modal>
        </div>
    );
};


// --- Component: Profile (Consolidated) ---
const Profile: React.FC<ProfileComponentProps> = ({ userProfile, updateUserProfile, incomes, expenses }) => {
    const [currentBalance, setCurrentBalance] = useState<string>(userProfile?.currentBalance?.toString() || '');
    const [grossSalaryIncome, setGrossSalaryIncome] = useState<string>(userProfile?.salaryIncome?.toString() || '');
    const [salaryFrequency, setSalaryFrequency] = useState<'weekly' | 'fortnightly' | 'monthly'>(userProfile?.salaryFrequency || 'monthly');
    const [name, setName] = useState<string>(userProfile?.name || '');
    const [numberOfDaysOffPerMonth, setNumberOfDaysOffPerMonth] = useState<string>(userProfile?.numberOfDaysOffPerMonth?.toString() || '0');

    // State for individual deductions
    const [deductions, setDeductions] = useState<{ [key: string]: string }>(() => {
        const initialDeductions = {
            'SSS': '0',
            'GSIS': '0',
            'Philhealth': '0',
            'Pag-Ibig Fund': '0',
            'Company Initiated Deductions': '0',
            'Voluntary Deductions': '0',
            'Property Annual Fee': '0',
        };
        return userProfile?.deductions?.reduce((acc: { [key: string]: string }, d: DeductionItem) => { // Explicitly typed acc and d
            if (initialDeductions.hasOwnProperty(d.name)) {
                return { ...acc, [d.name]: d.amount.toString() };
            }
            return acc;
        }, initialDeductions) || initialDeductions;
    });
    const [customDeductions, setCustomDeductions] = useState<DeductionItem[]>(userProfile?.deductions?.filter(d => !['SSS', 'GSIS', 'Philhealth', 'Pag-Ibig Fund', 'Company Initiated Deductions', 'Voluntary Deductions', 'Property Annual Fee'].includes(d.name)) || []);
    const [newCustomDeductionName, setNewCustomDeductionName] = useState<string>('');
    const [newCustomDeductionAmount, setNewCustomDeductionAmount] = useState<string>('');

    // State for loans
    const [loans, setLoans] = useState<LoanItem[]>(userProfile?.loans || []);
    const [newLoanName, setNewLoanName] = useState<string>('');
    const [newLoanAmount, setNewLoanAmount] = useState<string>('');
    const [newLoanPaymentFrequency, setNewLoanPaymentFrequency] = useState<'monthly' | 'quarterly' | 'annually'>('monthly');
    const [newLoanNextPaymentDate, setNewLoanNextPaymentDate] = useState<string>('');

    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [modalMessage, setModalMessage] = useState<string>('');
    const [modalTitle, setModalTitle] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isResetSalaryConfirmOpen, setIsResetSalaryConfirmOpen] = useState<boolean>(false);

    useEffect(() => {
        setCurrentBalance(userProfile?.currentBalance?.toString() || '');
        setGrossSalaryIncome(userProfile?.salaryIncome?.toString() || '');
        setSalaryFrequency(userProfile?.salaryFrequency || 'monthly');
        setName(userProfile?.name || '');
        setNumberOfDaysOffPerMonth(userProfile?.numberOfDaysOffPerMonth?.toString() || '0');

        const initialDeductions = {
            'SSS': '0', 'GSIS': '0', 'Philhealth': '0', 'Pag-Ibig Fund': '0',
            'Company Initiated Deductions': '0', 'Voluntary Deductions': '0', 'Property Annual Fee': '0',
        };
        const updatedDeductions = userProfile?.deductions?.reduce((acc: { [key: string]: string }, d: DeductionItem) => { // Explicitly typed acc and d
            if (initialDeductions.hasOwnProperty(d.name)) {
                return { ...acc, [d.name]: d.amount.toString() };
            }
            return acc;
        }, initialDeductions) || initialDeductions;
        setDeductions(updatedDeductions);

        const filteredCustomDeductions = userProfile?.deductions?.filter(d => !Object.keys(initialDeductions).includes(d.name)) || [];
        setCustomDeductions(filteredCustomDeductions);

        setLoans(userProfile?.loans || []);
    }, [userProfile]);

    const handleDeductionChange = (name: string, value: string) => {
        setDeductions(prev => ({ ...prev, [name]: value }));
    };

    const handleAddCustomDeduction = () => {
        if (newCustomDeductionName && !isNaN(parseFloat(newCustomDeductionAmount)) && parseFloat(newCustomDeductionAmount) >= 0) {
            setCustomDeductions(prev => [
                ...prev,
                { name: newCustomDeductionName, amount: parseFloat(newCustomDeductionAmount) }
            ]);
            setNewCustomDeductionName('');
            setNewCustomDeductionAmount('');
        } else {
            setModalTitle("Input Error");
            setModalMessage("Please enter a valid name and non-negative amount for the custom deduction.");
            setIsModalOpen(true);
        }
    };

    const handleRemoveCustomDeduction = (index: number) => {
        setCustomDeductions(prev => prev.filter((_, i) => i !== index));
    };

    const handleAddLoan = () => {
        if (newLoanName && !isNaN(parseFloat(newLoanAmount)) && parseFloat(newLoanAmount) > 0 && newLoanNextPaymentDate) {
            setLoans(prev => [
                ...prev,
                {
                    id: crypto.randomUUID(), // Generate a unique ID for React key and internal management
                    loanName: newLoanName,
                    amount: parseFloat(newLoanAmount),
                    paymentFrequency: newLoanPaymentFrequency,
                    nextPaymentDate: new Date(newLoanNextPaymentDate),
                }
            ]);
            setNewLoanName('');
            setNewLoanAmount('');
            setNewLoanNextPaymentDate('');
            setNewLoanPaymentFrequency('monthly');
        } else {
            setModalTitle("Input Error");
            setModalMessage("Please fill in all valid fields for the new loan.");
            setIsModalOpen(true);
        }
    };

    const handleRemoveLoan = (id: string) => {
        setLoans(prev => prev.filter(loan => loan.id !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const parsedCurrentBalance = parseFloat(currentBalance);
            const parsedGrossSalaryIncome = parseFloat(grossSalaryIncome);
            const parsedNumberOfDaysOff = parseInt(numberOfDaysOffPerMonth);

            if (isNaN(parsedCurrentBalance) || parsedCurrentBalance < 0) {
                setModalTitle("Input Error");
                setModalMessage("Current Balance must be a non-negative number.");
                setIsModalOpen(true);
                return;
            }
            if (isNaN(parsedGrossSalaryIncome) || parsedGrossSalaryIncome < 0) {
                setModalTitle("Input Error");
                setModalMessage("Gross Salary Income must be a non-negative number.");
                setIsModalOpen(true);
                return;
            }
            if (isNaN(parsedNumberOfDaysOff) || parsedNumberOfDaysOff < 0) {
                setModalTitle("Input Error");
                setModalMessage("Number of Days Off must be a non-negative integer.");
                setIsModalOpen(true);
                return;
            }
            if (!name) {
                setModalTitle("Input Error");
                setModalMessage("Please enter your name.");
                setIsModalOpen(true);
                return;
            }

            const allDeductions: DeductionItem[] = Object.entries(deductions).map(([name, amountStr]) => ({
                name,
                amount: parseFloat(amountStr) || 0
            })).concat(customDeductions);

            await updateUserProfile({
                currentBalance: parsedCurrentBalance,
                salaryIncome: parsedGrossSalaryIncome,
                salaryFrequency: salaryFrequency,
                lastUpdated: new Date(),
                name: name,
                numberOfDaysOffPerMonth: parsedNumberOfDaysOff,
                deductions: allDeductions,
                loans: loans
            });
            setModalTitle("Success!");
            setModalMessage("Profile updated successfully!");
            setIsModalOpen(true);
        }
        catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to update profile: ${(error as Error).message}`);
            setIsModalOpen(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetSalary = () => {
        setIsResetSalaryConfirmOpen(true);
        setModalTitle("Confirm Reset");
        setModalMessage("Are you sure you want to reset your salary information? This will set your gross salary, deductions, and days off to zero.");
    };

    const confirmResetSalary = async () => {
        setIsLoading(true);
        try {
            await updateUserProfile({
                salaryIncome: 0,
                deductions: [],
                numberOfDaysOffPerMonth: 0,
                lastUpdated: new Date(),
            });
            setModalTitle("Success!");
            setModalMessage("Salary information has been reset.");
            setIsModalOpen(true);
        } catch (error: unknown) {
            setModalTitle("Error");
            setModalMessage(`Failed to reset salary: ${(error as Error).message}`);
            setIsModalOpen(true);
        } finally {
            setIsResetSalaryConfirmOpen(false);
            setIsLoading(false);
        }
    };

    const calculatedCashBalance = incomes.reduce((sum: number, item: IncomeItem) => sum + item.amount, 0) -
                                  expenses.reduce((sum: number, item: ExpenseItem) => sum + item.amount, 0);
    const currentCashBalanceValue = userProfile?.currentBalance ?? calculatedCashBalance;

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const projectedSalaryPaymentsForProfile: IncomeItem[] = []; // Changed to const
    if (userProfile && userProfile.salaryIncome > 0) {
        const monthlySalary = userProfile.salaryIncome;
        const totalMonthlyDeductions = userProfile.deductions.reduce((sum: number, ded: DeductionItem) => sum + ded.amount, 0); // Explicitly typed
        const netMonthlySalary = monthlySalary - totalMonthlyDeductions;

        let numPayrollsPerMonth = 0;
        if (userProfile.salaryFrequency === 'monthly') numPayrollsPerMonth = 1;
        else if (userProfile.salaryFrequency === 'fortnightly') numPayrollsPerMonth = 2;
        else if (userProfile.salaryFrequency === 'weekly') numPayrollsPerMonth = 4;

        const salaryPerPayPeriod = netMonthlySalary / numPayrollsPerMonth;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thirtyDaysFromNowForProfile = new Date(today);
        thirtyDaysFromNowForProfile.setDate(today.getDate() + 30);

        const getNextPaydayProfile = (currentDate: Date, frequency: 'weekly' | 'fortnightly' | 'monthly'): Date | null => {
            let nextPay = new Date(currentDate);
            nextPay.setHours(0,0,0,0);

            if (frequency === 'monthly') {
                nextPay.setDate(15);
                if (nextPay.getTime() < currentDate.getTime()) {
                    nextPay.setMonth(nextPay.getMonth() + 1);
                    nextPay.setDate(15);
                }
                if (nextPay.getMonth() !== ((currentDate.getMonth() + (nextPay.getTime() < currentDate.getTime() ? 1 : 0)) % 12)) {
                    nextPay = new Date(nextPay.getFullYear(), nextPay.getMonth(), 0);
                }
            } else if (frequency === 'fortnightly') {
                const day = currentDate.getDate();
                if (day <= 1) {
                    nextPay.setDate(1);
                } else if (day <= 15) {
                    nextPay.setDate(15);
                } else {
                    nextPay.setMonth(nextPay.getMonth() + 1);
                    nextPay.setDate(1);
                }
                if (nextPay.getTime() < currentDate.getTime()) {
                     nextPay.setDate(nextPay.getDate() + 14);
                }
            } else if (frequency === 'weekly') {
                const dayOfWeek = nextPay.getDay();
                let daysUntilNextMonday = 0;
                if (dayOfWeek === 0) {
                    daysUntilNextMonday = 1;
                } else if (dayOfWeek === 1) {
                    daysUntilNextMonday = 7;
                } else {
                    daysUntilNextMonday = 8 - dayOfWeek;
                }
                nextPay.setDate(nextPay.getDate() + daysUntilNextMonday);

                if (nextPay.getTime() < currentDate.getTime()) {
                    nextPay.setDate(nextPay.getDate() + 7);
                }
            } else {
                return null;
            }
            nextPay.setHours(0,0,0,0);
            return nextPay;
        };

        let tempPayDate = new Date(today);
        let loopCount = 0;
        while (tempPayDate.getTime() <= thirtyDaysFromNowForProfile.getTime() && loopCount < 100) {
            const nextPayDate = getNextPaydayProfile(tempPayDate, userProfile.salaryFrequency);
            if (nextPayDate && nextPayDate.getTime() <= thirtyDaysFromNowForProfile.getTime()) {
                projectedSalaryPaymentsForProfile.push({
                    id: `salary-profile-${nextPayDate.toISOString()}-${loopCount}`,
                    client: `Salary Payment (${userProfile.salaryFrequency})`,
                    amount: salaryPerPayPeriod,
                    dueDate: nextPayDate,
                    status: 'Outstanding',
                    createdAt: new Date(),
                });
                tempPayDate = new Date(nextPayDate);
                tempPayDate.setDate(tempPayDate.getDate() + 1);
            } else {
                break;
            }
            loopCount++;
        }
    }

    const combinedUpcomingIncomes: IncomeItem[] = incomes // Changed to const
        .filter((inc: IncomeItem) => inc.status === 'Outstanding' && inc.dueDate.getTime() <= thirtyDaysFromNow.getTime())
        .concat(projectedSalaryPaymentsForProfile);

    combinedUpcomingIncomes.sort((a: IncomeItem, b: IncomeItem) => a.dueDate.getTime() - b.dueDate.getTime());

    const upcomingIncomesForDisplay = combinedUpcomingIncomes.slice(0, 5);
    const totalUpcomingIncomesAmount = combinedUpcomingIncomes.reduce((sum: number, item: IncomeItem) => sum + item.amount, 0); // Explicitly typed

    const upcomingExpensesForDisplay = expenses
        .filter((exp: ExpenseItem) => exp.date.getTime() <= thirtyDaysFromNow.getTime())
        .concat(
            (userProfile?.loans || []).filter(loan => loan.nextPaymentDate.getTime() <= thirtyDaysFromNow.getTime()).map(loan => ({
                id: loan.id,
                vendor: loan.loanName,
                amount: loan.amount,
                category: 'Loan Payment',
                date: loan.nextPaymentDate,
                description: `Loan payment for ${loan.loanName} (${loan.paymentFrequency})`,
                createdAt: new Date(),
            }))
        )
        .sort((a: ExpenseItem, b: ExpenseItem) => a.date.getTime() - b.date.getTime())
        .slice(0, 5);

    const totalUpcomingExpensesAmount = upcomingExpensesForDisplay.reduce((sum: number, item: ExpenseItem) => sum + item.amount, 0); // Explicitly typed
    const projectedShortTermBalanceValue = currentCashBalanceValue + totalUpcomingIncomesAmount - totalUpcomingExpensesAmount;

    const grossMonthlySalary = userProfile?.salaryIncome || 0;
    const totalMonthlyDeductions = Object.values(deductions).reduce((sum: number, amountStr: string) => sum + (parseFloat(amountStr) || 0), 0) + // Explicitly typed
                                   customDeductions.reduce((sum: number, d: DeductionItem) => sum + d.amount, 0); // Explicitly typed
    const netMonthlySalary = grossMonthlySalary - totalMonthlyDeductions;
    const monthlyWorkingDays = 22 - (userProfile?.numberOfDaysOffPerMonth || 0);
    const dailyIncome = monthlyWorkingDays > 0 ? netMonthlySalary / monthlyWorkingDays : 0;

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">User Profile</h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Profile Edit Form */}
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Edit Your Financial Profile</h2>
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6">
                        <div>
                            <label htmlFor="name" className="block text-gray-700 text-sm font-bold mb-2">Your Name</label>
                            <input
                                type="text"
                                id="name"
                                value={name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                placeholder="Your Full Name"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="currentBalance" className="block text-gray-700 text-sm font-bold mb-2">Current Cash Balance (PHP)</label>
                            <input
                                type="number"
                                id="currentBalance"
                                value={currentBalance}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentBalance(e.target.value)}
                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                placeholder="e.g., 10000"
                                step="0.01"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="grossSalaryIncome" className="block text-gray-700 text-sm font-bold mb-2">Gross Salary Income (PHP)</label>
                            <input
                                type="number"
                                id="grossSalaryIncome"
                                value={grossSalaryIncome}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGrossSalaryIncome(e.target.value)}
                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                placeholder="e.g., 30000"
                                step="0.01"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="salaryFrequency" className="block text-gray-700 text-sm font-bold mb-2">Salary Frequency</label>
                            <select
                                id="salaryFrequency"
                                value={salaryFrequency}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSalaryFrequency(e.target.value as 'weekly' | 'fortnightly' | 'monthly')}
                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                required
                            >
                                <option value="weekly">Weekly</option>
                                <option value="fortnightly">Fortnightly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="numberOfDaysOffPerMonth" className="block text-gray-700 text-sm font-bold mb-2">Regular Days Off Per Month (e.g., 8 for weekends)</label>
                            <input
                                type="number"
                                id="numberOfDaysOffPerMonth"
                                value={numberOfDaysOffPerMonth}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNumberOfDaysOffPerMonth(e.target.value)}
                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                placeholder="e.g., 8"
                                min="0"
                                required
                            />
                        </div>

                        {/* Deductions Card - Integrated into the form for submission */}
                        <div className="col-span-full bg-gray-50 p-6 rounded-lg border border-gray-200">
                            <h3 className="text-lg font-semibold text-gray-700 mb-4">Deductions</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Object.keys(deductions).map((deductionName) => (
                                    <div key={deductionName}>
                                        <label htmlFor={`deduction-${deductionName}`} className="block text-gray-700 text-sm font-medium mb-1">{deductionName}</label>
                                        <input
                                            type="number"
                                            id={`deduction-${deductionName}`}
                                            value={deductions[deductionName]}
                                            onChange={(e) => handleDeductionChange(deductionName, e.target.value)}
                                            className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                            step="0.01"
                                            min="0"
                                        />
                                    </div>
                                ))}
                            </div>
                            {/* Custom Deductions */}
                            <div className="mt-6 border-t pt-4 border-gray-200">
                                <h4 className="text-md font-medium text-gray-700 mb-3">Other Deductions</h4>
                                {customDeductions.map((deduction, index) => (
                                    <div key={index} className="flex items-center space-x-2 mb-2">
                                        <input
                                            type="text"
                                            value={deduction.name}
                                            onChange={(e) => setCustomDeductions(prev => {
                                                const newDeds = [...prev];
                                                newDeds[index].name = e.target.value;
                                                return newDeds;
                                            })}
                                            className="shadow appearance-none border rounded-md w-1/2 py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                            placeholder="Deduction Name"
                                        />
                                        <input
                                            type="number"
                                            value={deduction.amount.toString()}
                                            onChange={(e) => setCustomDeductions(prev => {
                                                const newDeds = [...prev];
                                                newDeds[index].amount = parseFloat(e.target.value) || 0;
                                                return newDeds;
                                            })}
                                            className="shadow appearance-none border rounded-md w-1/4 py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                            step="0.01"
                                            min="0"
                                            placeholder="Amount"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCustomDeduction(index)}
                                            className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition duration-200"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                                <div className="flex items-center space-x-2 mt-3">
                                    <input
                                        type="text"
                                        value={newCustomDeductionName}
                                        onChange={(e) => setNewCustomDeductionName(e.target.value)}
                                        className="shadow appearance-none border rounded-md w-1/2 py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                        placeholder="New Deduction Name"
                                    />
                                    <input
                                        type="number"
                                        value={newCustomDeductionAmount}
                                        onChange={(e) => setNewCustomDeductionAmount(e.target.value)}
                                        className="shadow appearance-none border rounded-md w-1/4 py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                        step="0.01"
                                        min="0"
                                        placeholder="Amount"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddCustomDeduction}
                                        className="px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition duration-200"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Loans Card */}
                        <div className="col-span-full bg-gray-50 p-6 rounded-lg border border-gray-200 mt-6">
                            <h3 className="text-lg font-semibold text-gray-700 mb-4">Loans</h3>
                            <div className="space-y-4">
                                {loans.length === 0 ? (
                                    <p className="text-gray-600 text-sm">No loans added yet.</p>
                                ) : (
                                    <ul className="space-y-3 max-h-48 overflow-y-auto pr-2">
                                        {loans.map((loan) => (
                                            <li key={loan.id} className="bg-white p-3 rounded-md shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center">
                                                <div>
                                                    <p className="font-semibold text-gray-900">{loan.loanName}</p>
                                                    <p className="text-sm text-gray-700">PHP {loan.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - {loan.paymentFrequency}</p>
                                                    <p className="text-xs text-gray-500">Next Payment: {loan.nextPaymentDate.toLocaleDateString()}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveLoan(loan.id)}
                                                    className="mt-2 sm:mt-0 px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition duration-200 text-sm"
                                                >
                                                    Remove
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {/* Add New Loan Form */}
                                <div className="mt-4 border-t pt-4 border-gray-200">
                                    <h4 className="text-md font-medium text-gray-700 mb-3">Add New Loan</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="newLoanName" className="block text-gray-700 text-sm font-medium mb-1">Loan Name</label>
                                            <input
                                                type="text"
                                                id="newLoanName"
                                                value={newLoanName}
                                                onChange={(e) => setNewLoanName(e.target.value)}
                                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                                placeholder="e.g., Car Loan"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="newLoanAmount" className="block text-gray-700 text-sm font-medium mb-1">Amount (PHP)</label>
                                            <input
                                                type="number"
                                                id="newLoanAmount"
                                                value={newLoanAmount}
                                                onChange={(e) => setNewLoanAmount(e.target.value)}
                                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                                step="0.01"
                                                min="0"
                                                placeholder="e.g., 10000"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="newLoanFrequency" className="block text-gray-700 text-sm font-medium mb-1">Payment Frequency</label>
                                            <select
                                                id="newLoanFrequency"
                                                value={newLoanPaymentFrequency}
                                                onChange={(e) => setNewLoanPaymentFrequency(e.target.value as 'monthly' | 'quarterly' | 'annually')}
                                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                            >
                                                <option value="monthly">Monthly</option>
                                                <option value="quarterly">Quarterly</option>
                                                <option value="annually">Annually</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="newLoanNextPaymentDate" className="block text-gray-700 text-sm font-medium mb-1">Next Payment Date</label>
                                            <input
                                                type="date"
                                                id="newLoanNextPaymentDate"
                                                value={newLoanNextPaymentDate}
                                                onChange={(e) => setNewLoanNextPaymentDate(e.target.value)}
                                                className="shadow appearance-none border rounded-md w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex justify-end mt-4">
                                        <button
                                            type="button"
                                            onClick={handleAddLoan}
                                            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition duration-200"
                                        >
                                            Add Loan
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end mt-4 col-span-full">
                            <button
                                type="button"
                                onClick={handleResetSalary}
                                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition duration-200 shadow-sm cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed mr-3"
                                disabled={isLoading}
                            >
                                {isLoading ? 'Resetting...' : 'Reset Salary Info'}
                            </button>
                            <button
                                type="submit"
                                className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-md transition duration-200 shadow-sm cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                                disabled={isLoading}
                            >
                                {isLoading ? 'Saving...' : 'Update Profile'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Right Column: Financial Summary Cards */}
                <div className="flex flex-col gap-6">
                     {/* Current Cash Balance Card */}
                    <div className="bg-white rounded-lg shadow-md p-6 border-b-4 border-orange-500 w-full">
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">Current Cash Balance</h2>
                        <p className="text-3xl font-bold text-orange-600">
                            PHP {currentCashBalanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>

                    {/* Projected Short-Term Balance Card */}
                    <div className="bg-white rounded-lg shadow-md p-6 border-b-4 border-slate-700 w-full">
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">Projected Short-Term Balance</h2>
                        <p className="text-3xl font-bold text-slate-800">
                            PHP {projectedShortTermBalanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>

                    {/* Upcoming Income Card */}
                    <div className="bg-white rounded-lg shadow-md p-6 border-b-4 border-emerald-700 w-full">
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">Upcoming Income (Next 30 Days)</h2>
                        <p className="text-2xl font-bold text-emerald-800 mb-2">
                            PHP {totalUpcomingIncomesAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {upcomingIncomesForDisplay.length === 0 ? (
                            <p className="text-sm text-gray-600">No outstanding invoices or estimated salary.</p>
                        ) : (
                            <ul className="list-none p-0 m-0 text-sm text-gray-800">
                                {upcomingIncomesForDisplay.map((income: IncomeItem) => (
                                    <li key={income.id} className="flex justify-between items-center py-0.5">
                                        <span>{income.client}</span>
                                        <span className="text-xs text-gray-500">{income.dueDate.toLocaleDateString()}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Upcoming Expenses Card */}
                    <div className="bg-white rounded-lg shadow-md p-6 border-b-4 border-amber-700 w-full">
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">Upcoming Expenses (Next 30 Days)</h2>
                        <p className="text-2xl font-bold text-amber-800 mb-2">
                            PHP {totalUpcomingExpensesAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {upcomingExpensesForDisplay.length === 0 ? (
                            <p className="text-sm text-gray-600">No upcoming expenses.</p>
                        ) : (
                            <ul className="list-none p-0 m-0 text-sm text-gray-800">
                                {upcomingExpensesForDisplay.map((expense: ExpenseItem) => (
                                    <li key={expense.id} className="flex justify-between items-center py-0.5">
                                        <span>{expense.vendor}</span>
                                        <span className="text-xs text-gray-500">{expense.date.toLocaleDateString()}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Salary Breakdown Section */}
            <div className="bg-white rounded-lg shadow-md p-6 mt-8">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Salary Breakdown</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-800">
                    <div className="flex justify-between py-1 border-b border-gray-100">
                        <span className="font-medium">Gross Monthly Salary:</span>
                        <span>PHP {grossMonthlySalary.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-gray-100">
                        <span className="font-medium">Total Monthly Deductions:</span>
                        <span>- PHP {totalMonthlyDeductions.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-gray-100 font-bold text-lg">
                        <span>Net Monthly Salary:</span>
                        <span>PHP {netMonthlySalary.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-gray-100">
                        <span className="font-medium">Monthly Working Days:</span>
                        <span>{monthlyWorkingDays} days</span>
                    </div>
                    <div className="flex justify-between py-1 font-bold text-xl text-orange-600">
                        <span>Daily Income (Net):</span>
                        <span>PHP {dailyIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                </div>
            </div>

            {/* Modals for alerts and confirmations */}
            <Modal
                isOpen={isModalOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsModalOpen(false)}
            />
            <Modal
                isOpen={isResetSalaryConfirmOpen}
                title={modalTitle}
                message={modalMessage}
                onClose={() => setIsResetSalaryConfirmOpen(false)}
                onConfirm={confirmResetSalary}
                showConfirmButton={true}
            />
        </div>
    );
};


// --- Component: Dashboard (Consolidated) ---
const Dashboard: React.FC<DashboardComponentProps> = ({ incomes, expenses, userProfile }) => {
    const [showProjectedDetails, setShowProjectedDetails] = useState(false);
    const [showExpenseDetails, setShowExpenseDetails] = useState(false);

    // Calculate current cash balance (simplified: total income - total expenses)
    const calculatedCashBalance = incomes.reduce((sum: number, item: IncomeItem) => sum + item.amount, 0) -
                                  expenses.reduce((sum: number, item: ExpenseItem) => sum + item.amount, 0);

    const currentCashBalance = userProfile?.currentBalance ?? calculatedCashBalance;

    // Simulate AI Cash Flow Forecast - now returns projectedSalaryPayments as well
    const { forecastData, potentialShortfallDate, projectedSalaryPayments } = generateMockForecast(currentCashBalance, incomes, expenses, userProfile);

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Combine actual incomes with projected salary payments for Dashboard display
    const combinedUpcomingIncomes: IncomeItem[] = [ // Changed to const
        ...incomes.filter((inc: IncomeItem) => inc.status === 'Outstanding' && inc.dueDate.getTime() <= thirtyDaysFromNow.getTime()),
        ...projectedSalaryPayments.filter((sal: IncomeItem) => sal.dueDate.getTime() <= thirtyDaysFromNow.getTime())
    ];

    // Sort combined upcoming incomes by due date
    combinedUpcomingIncomes.sort((a: IncomeItem, b: IncomeItem) => a.dueDate.getTime() - b.dueDate.getTime());

    // Update upcomingIncomesForDisplay and totalUpcomingIncomesAmount
    const upcomingIncomesForDisplay = combinedUpcomingIncomes.slice(0, 3); // Still show top 3 for brevity on card
    const totalUpcomingIncomesAmount = combinedUpcomingIncomes.reduce((sum: number, item: IncomeItem) => sum + item.amount, 0); // Explicitly typed

    const currentMonthExpenses = expenses.filter(exp => {
        const expDate = new Date(exp.date);
        const now = new Date();
        return expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear();
    });

    const totalCurrentMonthExpenses = currentMonthExpenses.reduce((sum: number, exp: ExpenseItem) => sum + exp.amount, 0); // Explicitly typed

    const totalUpcomingExpensesAmount = expenses
        .filter((exp: ExpenseItem) => exp.date.getTime() >= new Date().setHours(0,0,0,0) && exp.date.getTime() <= thirtyDaysFromNow.getTime())
        .concat(
            (userProfile?.loans || []).filter(loan => loan.nextPaymentDate.getTime() >= new Date().setHours(0,0,0,0) && loan.nextPaymentDate.getTime() <= thirtyDaysFromNow.getTime()).map(loan => ({
                id: loan.id,
                vendor: loan.loanName,
                amount: loan.amount,
                category: 'Loan Payment',
                date: loan.nextPaymentDate,
                description: `Loan payment for ${loan.loanName} (${loan.paymentFrequency})`,
                createdAt: new Date(),
            }))
        )
        .reduce((sum: number, item: ExpenseItem) => sum + item.amount, 0); // Explicitly typed

    const projectedOverallBalance = currentCashBalance + totalUpcomingIncomesAmount - totalUpcomingExpensesAmount;


    const chartData = {
        labels: forecastData.map(data => data.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [
            {
                label: 'Projected Cash Balance (PHP)',
                data: forecastData.map(data => data.balance),
                borderColor: '#F97316',
                backgroundColor: 'rgba(249, 115, 22, 0.2)',
                tension: 0.1,
                pointRadius: 3,
                pointBackgroundColor: '#F97316',
            },
        ],
    };

    const chartOptions: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
            },
            title: {
                display: true,
                text: 'AI-Powered Cash Flow Projection (Next ' + forecastData.length + ' Days)',
                font: {
                    size: 16,
                },
                color: '#374151',
            },
            tooltip: {
                callbacks: {
                    label: function(context: TooltipItem<'line'>) { // Explicitly typed context
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'PHP' }).format(context.parsed.y);
                        }
                        return label;
                    }
                }
            },
        },
        scales: {
            x: {
                title: {
                    display: true,
                    text: 'Date',
                    color: '#4B5563',
                },
                grid: {
                    display: false,
                },
                ticks: {
                    color: '#6B7280',
                }
            },
            y: {
                title: {
                    display: true,
                    text: 'Cash Balance (PHP)',
                    color: '#4B5563',
                },
                grid: {
                    color: '#E5E7EB',
                },
                ticks: {
                    callback: function(tickValue: string | number) { // Explicitly typed tickValue
                        const numericValue = typeof tickValue === 'string' ? parseFloat(tickValue) : tickValue;
                        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'PHP' }).format(numericValue);
                    }
                }
            },
        },
    };

    const expenseCategories = expenses.reduce((acc: { [key: string]: number }, expense: ExpenseItem) => { // Explicitly typed acc and expense
        acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
        return acc;
    }, {});

    const pieChartLabels = Object.keys(expenseCategories);
    const pieChartDataValues = Object.values(expenseCategories);

    const backgroundColors = [
        '#F97316', '#1F2937', '#374151', '#FBBF24', '#4B5563',
        '#6B7280', '#D97706', '#9CA3AF', '#DC2626', '#1E3A8A',
        '#059669', '#78716C', '#A16207', '#0F766E', '#475569',
        '#8B5CF6'
    ];

    const pieChartData = {
        labels: pieChartLabels,
        datasets: [
            {
                data: pieChartDataValues,
                backgroundColor: pieChartLabels.map((_, index) => backgroundColors[index % backgroundColors.length]),
                hoverBackgroundColor: pieChartLabels.map((_, index) => backgroundColors[index % backgroundColors.length]),
                borderColor: '#ffffff',
                borderWidth: 2,
            },
        ],
    };

    const pieChartOptions: ChartOptions<'pie'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right' as const,
                align: 'start',
                labels: {
                    font: {
                        size: 14,
                    },
                    color: '#4B5563',
                },
            },
            title: {
                display: true,
                text: 'Expense Categories Breakdown',
                font: {
                    size: 16,
                },
                color: '#374151',
            },
            tooltip: {
                callbacks: {
                    label: function(context: TooltipItem<'pie'>) { // Explicitly typed context
                        const label = context.label || '';
                        const value = context.parsed;
                        const total = context.dataset.data.reduce((sum: number, current: number) => sum + current, 0); // Explicitly typed sum and current
                        const percentage = total > 0 ? ((value / total) * 100).toFixed(2) + '%' : '0.00%';
                        return `${label}: PHP ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage})`;
                    },
                },
            },
        },
    };

    const monthlyExpensesByCategory = expenses
        .filter(exp => exp.date.getMonth() === new Date().getMonth() && exp.date.getFullYear() === new Date().getFullYear())
        .reduce((acc: { [key: string]: number }, expense: ExpenseItem) => { // Explicitly typed acc and expense
            acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
            return acc;
        }, {});

    const sortedMonthlyCategories = Object.entries(monthlyExpensesByCategory).sort(([, a], [, b]) => (b as number) - (a as number));


    return (
        <div className="max-w-full mx-auto p-4 md:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Dashboard</h1>

            <div className="lg:grid lg:grid-cols-3 lg:gap-8 flex flex-col items-stretch">
                {/* Left Column: New Combined Cards */}
                <div className="lg:col-span-1 flex flex-col gap-6 mb-8 lg:mb-0">
                    {/* Projected Balance Card */}
                    <div
                        className="bg-white rounded-lg shadow-md p-6 border-b-4 border-orange-500 cursor-pointer hover:shadow-lg transition-shadow duration-200"
                        onClick={() => setShowProjectedDetails(!showProjectedDetails)}
                    >
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">Projected Balance</h2>
                        <p className="text-4xl font-bold text-orange-600">
                            PHP {projectedOverallBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <h3 className="text-md font-semibold text-gray-700 mt-4 mb-2">Upcoming Income:</h3>
                        {upcomingIncomesForDisplay.length === 0 ? (
                            <p className="text-sm text-gray-600">No upcoming income listed.</p>
                        ) : (
                            <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
                                {upcomingIncomesForDisplay.map((income: IncomeItem) => (
                                    <li key={income.id}>
                                        {income.client} (PHP {income.amount.toLocaleString()}) - {income.dueDate.toLocaleDateString()}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="text-xs text-gray-500 mt-4">Click to {showProjectedDetails ? 'hide' : 'show'} details</p>

                        {showProjectedDetails && (
                            <div className="mt-6 pt-4 border-t border-gray-200 animate-slide-down">
                                <h4 className="font-medium text-gray-800 mb-2">Detailed Projection:</h4>
                                <div className="space-y-2 text-gray-700">
                                    <p><strong className="font-medium">Current Cash Balance:</strong> PHP {currentCashBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                    {userProfile?.salaryIncome && userProfile.salaryIncome > 0 && (
                                        <p><strong className="font-medium">Estimated Salary Income:</strong> PHP {userProfile.salaryIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({userProfile.salaryFrequency})</p>
                                    )}
                                    {combinedUpcomingIncomes.length > 0 && (
                                        <div>
                                            <h5 className="font-medium text-gray-800 mt-4 mb-2">All Upcoming Incomes:</h5>
                                            <ul className="list-disc list-inside text-sm pl-4 space-y-1">
                                                {combinedUpcomingIncomes.map(item => (
                                                    <li key={item.id}>
                                                        {item.client}: PHP {item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Due: {item.dueDate.toLocaleDateString()})
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {combinedUpcomingIncomes.length === 0 && userProfile?.salaryIncome === 0 && (
                                        <p className="text-sm text-gray-500">No specific upcoming income details available.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Expenses Card (Current Month) */}
                    <div
                        className="bg-white rounded-lg shadow-md p-6 border-b-4 border-amber-700 cursor-pointer hover:shadow-lg transition-shadow duration-200"
                        onClick={() => setShowExpenseDetails(!showExpenseDetails)}
                    >
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">Current Month Expenses</h2>
                        <p className="text-4xl font-bold text-amber-800">
                            PHP {totalCurrentMonthExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-sm text-gray-500 mt-2">
                            Total expenses for {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-gray-500 mt-4">Click to {showExpenseDetails ? 'hide' : 'show'} breakdown</p>

                        {showExpenseDetails && (
                            <div className="mt-6 pt-4 border-t border-gray-200 animate-slide-down">
                                <h4 className="font-medium text-gray-800 mb-2">Detailed Breakdown:</h4>
                                {sortedMonthlyCategories.length === 0 ? (
                                    <p className="text-gray-600">No expenses recorded for the current month.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {sortedMonthlyCategories.map(([category, amount]) => (
                                            <div key={category} className="flex justify-between items-center border-b border-gray-100 py-1">
                                                <span className="text-gray-700 font-medium">{category}:</span>
                                                <span className="text-gray-900 font-semibold">PHP {amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                        ))}
                                        <div className="pt-2 font-bold flex justify-between items-center text-lg text-gray-800">
                                            <span>Total:</span>
                                            <span>PHP {Object.values(monthlyExpensesByCategory).reduce((sum: number, val: number) => sum + val, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> {/* Explicitly typed */}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Middle Column: AI-Powered Cash Flow Projection Chart */}
                <div className="lg:col-span-1 bg-white rounded-lg shadow-md p-6 mb-8 lg:mb-0 flex flex-col justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-700 mb-2">AI-Powered Cash Flow Projection</h2>
                        {potentialShortfallDate ? (
                            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md relative text-sm mb-4">
                                <strong className="font-bold">AI Alert!</strong>{' '}
                                <span className="block sm:inline">Potential cash shortfall predicted around {potentialShortfallDate.toLocaleDateString()}. Consider reviewing your finances.</span>
                            </div>
                        ) : (
                            <div className="bg-emerald-100 border border-emerald-400 text-emerald-700 px-4 py-3 rounded-md relative text-sm mb-4">
                                <strong className="font-bold">Good News!</strong>{' '}
                                <span className="block sm:inline">Cash flow looks healthy for the projected period.</span>
                            </div>
                        )}
                    </div>
                    <div className="flex-grow flex items-center justify-center">
                        <div className="h-full w-full min-h-[300px]">
                            <Line data={chartData} options={chartOptions} />
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-4 text-center">
                        *This projection is based on your recorded income and expenses, and a simplified trend analysis for the MVP. More advanced AI models will be added in future updates.
                    </p>
                </div>

                {/* Right Column: Expense Categories Breakdown Chart */}
                <div className="lg:col-span-1 bg-white rounded-lg shadow-md p-6 flex flex-col justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-700 mb-4">Expense Categories Breakdown (Overall)</h2>
                    </div>
                    {pieChartDataValues.length === 0 ? (
                        <p className="text-gray-600 text-center py-4">No expense data to display for categories yet. Add some expenses!</p>
                    ) : (
                        <div className="flex-grow flex items-center justify-center">
                            <div className="h-full w-full min-h-[300px]">
                                <Pie data={pieChartData} options={pieChartOptions} />
                            </div>
                        </div>
                    )}
                    <p className="text-xs text-gray-500 mt-4 text-center">
                        *This chart visualizes the distribution of your recorded expenses by category.
                    </p>
                </div>
            </div>
        </div>
    );
};


// --- Main App Component ---
export default function App() {
    const {
        userId, userName, isAuthReady, incomes, expenses, userProfile,
        login, signup, logout,
        addIncome, updateIncomeStatus, deleteIncome,
        addExpense, deleteExpense,
        updateUserProfile,
        modalInfo, closeModal,
        firebaseInitialized
    } = useFirebaseData();

    const [currentPage, setCurrentPage] = useState<string>('dashboard');

    if (!firebaseInitialized) {
        return (
            <>
                <Modal
                    isOpen={modalInfo.isOpen}
                    title={modalInfo.title}
                    message={modalInfo.message}
                    onClose={closeModal}
                />
                <LoadingSpinner />
            </>
        );
    }

    if (!isAuthReady) {
        return <LoadingSpinner />;
    }

    if (!userId) {
        return (
            <AuthContext.Provider value={{ login, signup }}>
                <Auth />
            </AuthContext.Provider>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100">
            <style>
                {`
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-slide-down {
                    animation: slideDown 0.3s ease-out forwards;
                }
                `}
            </style>
            <Navbar
                userId={userId}
                userName={userName}
                onLogout={logout}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
            />
            <main className="pb-8 w-full">
                {currentPage === 'dashboard' && <Dashboard incomes={incomes} expenses={expenses} userProfile={userProfile} />}
                {currentPage === 'income' && (
                    <Income
                        addIncome={addIncome}
                        incomes={incomes}
                        updateIncomeStatus={updateIncomeStatus}
                        deleteIncome={deleteIncome}
                    />
                )}
                {currentPage === 'expenses' && (
                    <Expense
                        addExpense={addExpense}
                        expenses={expenses}
                        deleteExpense={deleteExpense}
                    />
                )}
                {currentPage === 'profile' && (
                    <Profile
                        userProfile={userProfile}
                        updateUserProfile={updateUserProfile}
                        incomes={incomes}
                        expenses={expenses}
                    />
                )}
            </main>
            <Modal
                isOpen={modalInfo.isOpen}
                title={modalInfo.title}
                message={modalInfo.message}
                onClose={() => setIsModalOpen(false)}
            />
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
        </div>
    );
}